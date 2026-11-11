//! Kraj z pozycji GPS dla Paszportu - całkowicie w pamięci serwera, bez zewnętrznych usług (współrzędne gracza nigdzie nie wychodzą).
//!
//! Granice to uproszczone poligony Natural Earth 10m (domena publiczna), wbudowane w plik wykonywalny (`data/borders.bin`,
//! tworzy je `scripts/passport/build-borders.mjs`; format opisany w nagłówku skryptu). Terytoria zależne należą do państwa
//! suwerennego (Grenlandia = Dania, Gujana Francuska = Francja), więc mamy dokładnie 196 państw uznawanych przez Polskę.
//! Punkt w środku poligonu wygrywa; punkt tuż przy wodzie (do `NEAR_M` od brzegu) trafia do najbliższego państwa.

use std::collections::HashMap;
use std::sync::LazyLock;

use parking_lot::Mutex;

static DATA: &[u8] = include_bytes!("../data/borders.bin");

/// Jak daleko od granicy lądu (w metrach) punkt na wodzie albo na pominiętej wysepce nadal liczy się do najbliższego państwa
pub const NEAR_M: f64 = 5000.0;

/// Jednostka współrzędnych w pliku: 1e-4 stopnia
const SCALE: f64 = 1e4;

struct Ring {
    min_x: i32,
    max_x: i32,
    min_y: i32,
    max_y: i32,
    pts: Vec<(i32, i32)>,
}

impl Ring {
    fn contains_bbox(&self, x: i32, y: i32) -> bool {
        x >= self.min_x && x <= self.max_x && y >= self.min_y && y <= self.max_y
    }

    fn area(&self) -> i64 {
        i64::from(self.max_x - self.min_x) * i64::from(self.max_y - self.min_y)
    }

    /// Reguła parzysto-nieparzysta (promień w prawo)
    fn inside(&self, x: i32, y: i32) -> bool {
        let mut inside = false;
        let mut j = self.pts.len() - 1;
        for i in 0..self.pts.len() {
            let ((xi, yi), (xj, yj)) = (self.pts[i], self.pts[j]);
            if (yi > y) != (yj > y) {
                let d = i64::from(yj - yi);
                let lhs = i64::from(x - xi) * d;
                let rhs = i64::from(xj - xi) * i64::from(y - yi);
                if (d > 0 && lhs < rhs) || (d < 0 && lhs > rhs) {
                    inside = !inside;
                }
            }
            j = i;
        }
        inside
    }

    /// Odległość (w metrach) od najbliższego odcinka obrysu; płaszczyzna lokalna wokół punktu
    fn distance_m(&self, x: i32, y: i32, cos_lat: f64) -> f64 {
        let to_m = |dx: f64, dy: f64| ((dx * cos_lat).powi(2) + dy.powi(2)).sqrt() * 111_320.0 / SCALE;
        let (px, py) = (f64::from(x), f64::from(y));
        let mut best = f64::MAX;
        let mut j = self.pts.len() - 1;
        for i in 0..self.pts.len() {
            let (ax, ay) = (f64::from(self.pts[j].0) - px, f64::from(self.pts[j].1) - py);
            let (bx, by) = (f64::from(self.pts[i].0) - px, f64::from(self.pts[i].1) - py);
            // odległość początku układu od odcinka AB (z poprawką na zbieżność południków)
            let (ux, uy) = ((bx - ax) * cos_lat, by - ay);
            let len2 = ux * ux + uy * uy;
            let t = if len2 == 0.0 { 0.0 } else { (-(ax * cos_lat) * ux - ay * uy) / len2 }.clamp(0.0, 1.0);
            let d = to_m(ax + (bx - ax) * t, ay + (by - ay) * t);
            best = best.min(d);
            j = i;
        }
        best
    }
}

/// Ile punktów obrysu (najwyżej) kraj zostawia do liczenia odległości między państwami
const SAMPLE_MAX: usize = 1200;

struct Country {
    code: [u8; 2],
    /// próbka punktów obrysu jako wektory jednostkowe (do odległości między państwami)
    samples: Vec<[f32; 3]>,
    /// największa przerwa (km) między sąsiednimi punktami próbki - o tyle odległość z próbki może być zawyżona
    gap_km: f64,
    rings: Vec<Ring>,
    min_x: i32,
    max_x: i32,
    min_y: i32,
    max_y: i32,
}

pub struct Borders {
    countries: Vec<Country>,
}

struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn byte(&mut self) -> Option<u8> {
        let b = *self.data.get(self.at)?;
        self.at += 1;
        Some(b)
    }

    fn varint(&mut self) -> Option<u64> {
        let (mut v, mut shift) = (0u64, 0);
        loop {
            let b = self.byte()?;
            v |= u64::from(b & 127) << shift;
            if b < 128 {
                return Some(v);
            }
            shift += 7;
            if shift > 63 {
                return None;
            }
        }
    }

    fn zigzag(&mut self) -> Option<i64> {
        let v = self.varint()?;
        Some(if v & 1 == 1 { -(((v + 1) / 2) as i64) } else { (v / 2) as i64 })
    }
}

fn unit(x: i32, y: i32) -> [f32; 3] {
    let (lon, lat) = ((f64::from(x) / SCALE).to_radians(), (f64::from(y) / SCALE).to_radians());
    [(lat.cos() * lon.cos()) as f32, (lat.cos() * lon.sin()) as f32, lat.sin() as f32]
}

fn chord_km(a: &[f32; 3], b: &[f32; 3]) -> f64 {
    let d = (0..3).map(|i| f64::from(a[i] - b[i]).powi(2)).sum::<f64>().sqrt();
    2.0 * (d / 2.0).min(1.0).asin() * 6371.0
}

/// Równomierna próbka punktów obrysu i największa przerwa między sąsiednimi punktami próbki (w obrębie pierścienia)
fn sample(rings: &[Ring]) -> (Vec<[f32; 3]>, f64) {
    let total: usize = rings.iter().map(|r| r.pts.len()).sum();
    let step = total.div_ceil(SAMPLE_MAX).max(1);
    let (mut out, mut gap) = (Vec::new(), 0.0f64);
    for r in rings {
        let mut prev: Option<[f32; 3]> = None;
        for &(x, y) in r.pts.iter().step_by(step) {
            let u = unit(x, y);
            if let Some(p) = prev {
                gap = gap.max(chord_km(&p, &u));
            }
            prev = Some(u);
            out.push(u);
        }
    }
    (out, gap)
}

fn parse(data: &[u8]) -> Option<Borders> {
    if data.get(..4)? != b"SBB1" {
        return None;
    }
    let count = usize::from(data[4]) | usize::from(*data.get(5)?) << 8;
    let mut r = Reader { data, at: 6 };
    let mut countries = Vec::with_capacity(count);
    for _ in 0..count {
        let code = [r.byte()?, r.byte()?];
        let mut rings = Vec::new();
        for _ in 0..r.varint()? {
            let n = r.varint()? as usize;
            let mut pts = Vec::with_capacity(n);
            let (mut x, mut y) = (0i64, 0i64);
            for i in 0..n {
                let (dx, dy) = (r.zigzag()?, r.zigzag()?);
                if i == 0 {
                    (x, y) = (dx, dy);
                } else {
                    x += dx;
                    y += dy;
                }
                pts.push((x as i32, y as i32));
            }
            if n < 3 {
                continue;
            }
            let bounds = |f: fn(&(i32, i32)) -> i32| (pts.iter().map(f).min().unwrap_or(0), pts.iter().map(f).max().unwrap_or(0));
            let ((min_x, max_x), (min_y, max_y)) = (bounds(|p| p.0), bounds(|p| p.1));
            rings.push(Ring { min_x, max_x, min_y, max_y, pts });
        }
        let min_x = rings.iter().map(|r| r.min_x).min()?;
        let max_x = rings.iter().map(|r| r.max_x).max()?;
        let min_y = rings.iter().map(|r| r.min_y).min()?;
        let max_y = rings.iter().map(|r| r.max_y).max()?;
        let (samples, gap_km) = sample(&rings);
        countries.push(Country { code, samples, gap_km, rings, min_x, max_x, min_y, max_y });
    }
    Some(Borders { countries })
}

static BORDERS: LazyLock<Borders> = LazyLock::new(|| parse(DATA).expect("data/borders.bin jest uszkodzony (odtwórz: node scripts/passport/build-borders.mjs)"));

/// Wczytuje granice od razu (przy starcie), żeby uszkodzony plik wyszedł od razu, a nie przy pierwszym graczu
pub fn load() -> usize {
    BORDERS.countries.len()
}

/// Kody ISO wszystkich państw z granicami
pub fn codes() -> impl Iterator<Item = &'static str> {
    BORDERS.countries.iter().map(|c| std::str::from_utf8(&c.code).unwrap_or("??"))
}

static DISTANCES: LazyLock<Mutex<HashMap<(String, String), f64>>> = LazyLock::new(Mutex::default);

/// Dolne oszacowanie odległości (km) między granicami dwóch państw, czyli tyle, ile najmniej trzeba przebyć, żeby przejść z jednego do drugiego
/// (sąsiedzi = 0). Liczone z próbki obrysów i pomniejszone o ich rozrzedzenie, więc raczej za mało niż za dużo: służy do sprawdzania,
/// czy gracz mógł się przemieścić między dwoma państwami w danym czasie (Paszport, `routes/passport.rs`).
pub fn min_distance_km(a: &str, b: &str) -> Option<f64> {
    if a == b {
        return Some(0.0);
    }
    let key = if a < b { (a.to_owned(), b.to_owned()) } else { (b.to_owned(), a.to_owned()) };
    if let Some(d) = DISTANCES.lock().get(&key) {
        return Some(*d);
    }
    let find = |code: &str| BORDERS.countries.iter().find(|c| c.code == code.as_bytes());
    let (ca, cb) = (find(a)?, find(b)?);
    let mut best = f32::MAX;
    for p in &ca.samples {
        for q in &cb.samples {
            let d = (p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2);
            if d < best {
                best = d;
            }
        }
    }
    let approx = 2.0 * (f64::from(best.sqrt()) / 2.0).min(1.0).asin() * 6371.0;
    let d = (approx - (ca.gap_km + cb.gap_km) / 2.0).max(0.0);
    DISTANCES.lock().insert(key, d);
    Some(d)
}

/// Czy taki kod państwa jest w Paszporcie
pub fn has(code: &str) -> bool {
    codes().any(|c| c == code)
}

/// Kod ISO państwa, w którym leży punkt (stopnie dziesiętne), albo None (morze, Antarktyda, państwa nieuznawane przez Polskę)
pub fn country_at(lat: f64, lon: f64) -> Option<&'static str> {
    if !(lat.is_finite() && lon.is_finite()) || !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return None;
    }
    let (x, y) = ((lon * SCALE).round() as i32, (lat * SCALE).round() as i32);

    // 1. punkt wewnątrz poligonu; przy nakładających się obrysach wygrywa państwo o najmniejszym pierścieniu (enklawy)
    let mut best: Option<(i64, &Country)> = None;
    for c in &BORDERS.countries {
        if x < c.min_x || x > c.max_x || y < c.min_y || y > c.max_y {
            continue;
        }
        let (mut odd, mut area) = (false, i64::MAX);
        for r in &c.rings {
            if r.contains_bbox(x, y) && r.inside(x, y) {
                odd = !odd;
                area = area.min(r.area());
            }
        }
        if odd && best.is_none_or(|(a, _)| area < a) {
            best = Some((area, c));
        }
    }
    if let Some((_, c)) = best {
        return std::str::from_utf8(&c.code).ok();
    }

    // 2. tuż przy brzegu: najbliższe państwo w promieniu NEAR_M
    let cos_lat = lat.to_radians().cos().max(0.05);
    let pad_y = (NEAR_M / 111_320.0 * SCALE).ceil() as i32 + 1;
    let pad_x = (f64::from(pad_y) / cos_lat).ceil() as i32;
    let mut near: Option<(f64, &Country)> = None;
    for c in &BORDERS.countries {
        if x < c.min_x - pad_x || x > c.max_x + pad_x || y < c.min_y - pad_y || y > c.max_y + pad_y {
            continue;
        }
        for r in &c.rings {
            if x < r.min_x - pad_x || x > r.max_x + pad_x || y < r.min_y - pad_y || y > r.max_y + pad_y {
                continue;
            }
            let d = r.distance_m(x, y, cos_lat);
            if d <= NEAR_M && near.is_none_or(|(b, _)| d < b) {
                near = Some((d, c));
            }
        }
    }
    near.and_then(|(_, c)| std::str::from_utf8(&c.code).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_countries_present() {
        assert_eq!(load(), 196);
        for c in ["PL", "XK", "PS", "VA", "SG", "TV"] {
            assert!(has(c), "{c}");
        }
        assert!(!has("TW"));
    }

    #[test]
    fn known_places() {
        let cases: &[(&str, f64, f64, Option<&str>)] = &[
            ("Warszawa", 52.2297, 21.0122, Some("PL")),
            ("Gdańsk", 54.3520, 18.6466, Some("PL")),
            ("Paryż", 48.8566, 2.3522, Some("FR")),
            ("Watykan, plac św. Piotra", 41.9022, 12.4568, Some("VA")),
            ("Watykan, Muzea Watykańskie", 41.9065, 12.4536, Some("VA")),
            ("Watykan, Bazylika św. Piotra", 41.9022, 12.4539, Some("VA")),
            ("Rzym, Zamek Świętego Anioła", 41.9031, 12.4663, Some("IT")),
            ("Rzym", 41.9028, 12.4964, Some("IT")),
            ("Hebron (Zachodni Brzeg)", 31.5326, 35.0998, Some("PS")),
            ("Jerycho", 31.8667, 35.4500, Some("PS")),
            ("Prisztina", 42.6629, 21.1655, Some("XK")),
            ("Ramallah", 31.9038, 35.2034, Some("PS")),
            ("Gaza", 31.5017, 34.4668, Some("PS")),
            ("Tel Awiw", 32.0853, 34.7818, Some("IL")),
            ("Monako", 43.7384, 7.4246, Some("MC")),
            ("San Marino", 43.9424, 12.4578, Some("SM")),
            ("Vaduz", 47.1410, 9.5215, Some("LI")),
            ("Singapur", 1.3521, 103.8198, Some("SG")),
            ("Malé", 4.1755, 73.5093, Some("MV")),
            ("Funafuti", -8.5243, 179.1942, Some("TV")),
            ("Yaren, Nauru", -0.5477, 166.9209, Some("NR")),
            ("Majuro", 7.0897, 171.3803, Some("MH")),
            ("Valletta", 35.8989, 14.5146, Some("MT")),
            ("Reykjavik", 64.1466, -21.9426, Some("IS")),
            ("Honolulu (USA)", 21.3069, -157.8583, Some("US")),
            ("Cayenne (Francja)", 4.9224, -52.3135, Some("FR")),
            ("Nuuk (Dania)", 64.1814, -51.6941, Some("DK")),
            ("Hongkong (Chiny)", 22.3193, 114.1694, Some("CN")),
            ("Maseru, enklawa w RPA", -29.3100, 27.4800, Some("LS")),
            ("Kaliningrad", 54.7104, 20.4522, Some("RU")),
            ("Moskwa", 55.7558, 37.6173, Some("RU")),
            ("Nikozja", 35.1856, 33.3823, Some("CY")),
            ("Kirinyaga, Kenia", -0.4, 37.3, Some("KE")),
            ("Tokio", 35.6762, 139.6503, Some("JP")),
            ("Nowy Jork", 40.7128, -74.0060, Some("US")),
            ("Sydney", -33.8688, 151.2093, Some("AU")),
            ("Wellington", -41.2865, 174.7762, Some("NZ")),
            ("Fidżi, Suva", -18.1416, 178.4419, Some("FJ")),
            ("Samoa, Apia", -13.8333, -171.7500, Some("WS")),
            ("Tonga, Nukuʻalofa", -21.1394, -175.2018, Some("TO")),
            ("Kiribati, Bairiki (Tarawa)", 1.3278, 172.9776, Some("KI")),
            ("Palau, Koror", 7.3419, 134.4792, Some("PW")),
            ("Seszele, Victoria", -4.6191, 55.4513, Some("SC")),
            ("Malediwy, Addu", -0.6300, 73.1500, Some("MV")),
            ("Andora la Vella", 42.5063, 1.5218, Some("AD")),
            ("Luksemburg", 49.6116, 6.1319, Some("LU")),
            ("Tajpej (nieuznawane)", 25.0330, 121.5654, None),
            ("środek Atlantyku", 0.0, -30.0, None),
            ("Antarktyda", -80.0, 0.0, None),
            ("nieprawidłowe", 123.0, 0.0, None),
        ];
        let wrong: Vec<String> = cases
            .iter()
            .filter(|(_, lat, lon, want)| country_at(*lat, *lon) != *want)
            .map(|(name, lat, lon, want)| format!("{name}: jest {:?}, miało być {want:?}", country_at(*lat, *lon)))
            .collect();
        assert!(wrong.is_empty(), "{wrong:#?}");
    }

    #[test]
    fn distances_between_countries() {
        assert_eq!(min_distance_km("PL", "PL"), Some(0.0));
        assert!(min_distance_km("PL", "DE").unwrap() < 30.0, "sąsiedzi");
        assert!(min_distance_km("PL", "CZ").unwrap() < 30.0);
        let jp = min_distance_km("JP", "PL").unwrap();
        assert!((5500.0..8500.0).contains(&jp), "Polska - Japonia: {jp}");
        assert_eq!(min_distance_km("PL", "JP"), Some(jp), "symetria");
        let au = min_distance_km("PL", "AU").unwrap();
        assert!(au > 8000.0, "Polska - Australia: {au}");
        assert!(min_distance_km("PL", "XX").is_none());
    }

    #[test]
    fn near_the_coast_counts_but_far_at_sea_does_not() {
        // ok. 2 km w morzu od Gdyni: najbliższy kraj to Polska
        assert_eq!(country_at(54.5300, 18.6300), Some("PL"));
        // otwarte morze, Bałtyk na wysokości Gotlandii
        assert_eq!(country_at(56.5, 19.5), None);
    }
}
