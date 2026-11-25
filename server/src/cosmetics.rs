//! Kosmetyki profilu: cztery rodzaje na JEDNEJ zasadzie (jeden katalog, jedna tabela odblokowań, jeden wybór gracza).
//!
//! - `mini`  - tło miniprofilu (okienko po najechaniu na nazwę gracza), 600 x 400 px,
//! - `frame` - obramówka zdjęcia profilowego, 256 x 256 px, przezroczysty środek (zdjęcie widać w środku),
//! - `bg`    - tło całej strony profilu `/player/<nazwa>`, 1600 x 900 px,
//! - `avatar` - własne zdjęcie profilowe (sklep), 256 x 256 px, statyczne albo animowane; zdjęcie z karty zostaje darmowe.
//!
//! Katalog (`cosmetics`) wgrywa admin (panel „Kosmetyki profilu”); obrazek trzyma baza (BYTEA, jak ikony Paszportu i naklejki), adres
//! `/cosmetic/<id>?v=<wersja>`. Wymiary są sztywne i sprawdzane na serwerze ([`process_image`]): statyczny obrazek (PNG / JPEG / WebP / 1 klatka GIF)
//! zamieniamy na WebP, animowany (GIF, animowany WebP, APNG) zostaje bez zmian, ale musi mieć dokładnie te same wymiary i zmieścić się w limicie.
//!
//! Gracz NIE ma niczego domyślnie. Pozycję odblokowuje nagroda (`{"type": "cosmetic", "id": "..."}` - osiągnięcia, kalendarz adwentowy, nagrody
//! leveli EXP, Paszport), automat (`auto`: wygrany quest Wanted / CTF, odznaka służby) albo admin ręcznie. Odblokowanie jest raz na pozycję
//! (`user_cosmetics`, klucz główny user + pozycja), a założyć można tylko to, co odblokowane i włączone ([`can_equip`]).
//!
//! Rejestr katalogu (bez obrazków) jest w pamięci procesu, bo walidacja nagród (`events::clean_reward`) jest synchroniczna i bez dostępu do bazy.

use std::collections::HashSet;
use std::io::Cursor;
use std::sync::{Arc, LazyLock};

use image::{AnimationDecoder, ImageReader};
use parking_lot::RwLock;
use serde_json::{json, Value};

use crate::db::{now, Conn};
use crate::game::Relation;

/// Najwięcej pozycji w katalogu
pub const MAX_COSMETICS: i64 = 300;
/// Wartości `auto`: odblokowanie bez nagrody, samym zdarzeniem. (klucz, opis dla admina)
pub const AUTO: &[(&str, &str)] = &[
    ("", "Tylko nagrodą / ręcznie"),
    ("quest_wanted", "Wygranie questa Wanted"),
    ("quest_ctf", "Wygranie questa CTF"),
    ("service", "Odznaka „za służbę” (level 100)"),
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Mini,
    Frame,
    Bg,
    /// własne zdjęcie profilowe (zamiast zdjęcia z karty, które jest darmowe)
    Avatar,
}

pub const KINDS: [Kind; 4] = [Kind::Mini, Kind::Frame, Kind::Bg, Kind::Avatar];

impl Kind {
    pub fn key(self) -> &'static str {
        match self {
            Kind::Mini => "mini",
            Kind::Frame => "frame",
            Kind::Bg => "bg",
            Kind::Avatar => "avatar",
        }
    }

    pub fn from_key(k: &str) -> Option<Kind> {
        KINDS.into_iter().find(|x| x.key() == k)
    }

    pub fn label(self) -> &'static str {
        match self {
            Kind::Mini => "Tło miniprofilu",
            Kind::Frame => "Obramówka zdjęcia profilowego",
            Kind::Bg => "Tło profilu",
            Kind::Avatar => "Zdjęcie profilowe",
        }
    }

    /// Wymagane wymiary obrazka (szerokość, wysokość) w pikselach
    pub fn size(self) -> (u32, u32) {
        match self {
            Kind::Mini => (600, 400),
            Kind::Frame => (256, 256),
            Kind::Bg => (1600, 900),
            Kind::Avatar => (256, 256),
        }
    }

    /// Największy plik (bajty) - dotyczy też animacji, które zostają bez zmian
    pub fn max_bytes(self) -> usize {
        match self {
            Kind::Mini => 3 * 1024 * 1024,
            Kind::Frame => 1536 * 1024,
            Kind::Bg => 6 * 1024 * 1024,
            Kind::Avatar => 1536 * 1024,
        }
    }

    /// Opis wymagań dla admina (panel pokazuje to przy wgrywaniu)
    pub fn requirements(self) -> String {
        let (w, h) = self.size();
        let extra = match self {
            Kind::Mini => "Proporcje 3:2. Pod tekstem leży przyciemniająca warstwa w kolorach motywu, więc obrazek może być jaskrawy.",
            Kind::Frame => "Kwadrat; środek (około 40% szerokości) MUSI być przezroczysty - tam widać zdjęcie gracza. Ozdoba leży na brzegach.",
            Kind::Bg => "Proporcje 16:9. Na obrazku leży warstwa w kolorach motywu, więc tekst zostaje czytelny.",
            Kind::Avatar => "Kwadrat; grafika jest przycinana do koła, więc ważne rzeczy daj na środku. To własne zdjęcia profilowe (sklep), inne niż zdjęcia z kart, które są darmowe.",
        };
        format!(
            "{w} × {h} px (dokładnie), PNG / WebP / GIF / JPEG, najwyżej {} KB. {extra} Animowany GIF lub WebP jest dozwolony (w trybie wydajności gracz widzi pierwszą klatkę).",
            self.max_bytes() / 1024
        )
    }
}

/// Pozycja katalogu (bez obrazka)
#[derive(Clone, Debug)]
pub struct Cosmetic {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    /// Opis „jak zdobyć” dla gracza
    pub source: String,
    pub auto: String,
    pub enabled: bool,
    /// zablokowaną pozycję graczom, którzy jej nie mają, w ogóle się nie pokazuje
    pub hide_locked: bool,
    pub pos: i32,
    pub mime: String,
    pub w: i32,
    pub h: i32,
    pub animated: bool,
    /// wersja obrazka (adres z `?v=`)
    pub img_at: f64,
    /// cena w euro (sklep kosmetyków; 0 = cena nieustawiona, nie da się kupić)
    pub price: i64,
    /// czy kosmetyk jest w sklepie (domyślnie tak); `false` = zdobywa się go inaczej (quest, event, osiągnięcie...) i w sklepie widzi go tylko admin
    pub in_shop: bool,
    /// tagi koloru (klucze z `COLORS`): wykrywane przy wgraniu grafiki, admin może je poprawić
    pub tags: Vec<String>,
    /// limit sztuk (None = bez limitu) i okno sprzedaży (czas unixowy, None = bez ograniczenia); ile sprzedano - w bazie (`cosmetics.sold`)
    pub stock: Option<i32>,
    pub sale_from: Option<f64>,
    pub sale_to: Option<f64>,
}

/// Tagi koloru do wyszukiwania w sklepie: (klucz, nazwa)
pub const COLORS: &[(&str, &str)] = &[
    ("red", "czerwony"), ("orange", "pomarańczowy"), ("yellow", "żółty"), ("green", "zielony"), ("cyan", "turkusowy"), ("blue", "niebieski"),
    ("purple", "fioletowy"), ("pink", "różowy"), ("brown", "brązowy"), ("white", "biały"), ("gray", "szary"), ("black", "czarny"),
];

/// Tagi z tekstu (lista kluczy po przecinku): tylko znane, bez powtórzeń, w kolejności palety
pub fn clean_tags(raw: &str) -> Vec<String> {
    let want: HashSet<&str> = raw.split([',', ' ', ';']).map(str::trim).filter(|s| !s.is_empty()).collect();
    COLORS.iter().filter(|(k, _)| want.contains(k)).map(|(k, _)| (*k).to_owned()).collect()
}

/// Kolory dominujące na obrazku: piksele półprzezroczyste i przezroczyste (tło obramówek) się nie liczą; tag dostaje kolor zajmujący co najmniej
/// 12% widocznych pikseli (najwyżej cztery, zawsze co najmniej jeden najczęstszy). Obrazek jest wcześniej zmniejszany, więc to kilka milisekund.
pub fn detect_colors(im: &image::RgbaImage) -> Vec<String> {
    let (w, h) = im.dimensions();
    if w == 0 || h == 0 {
        return vec![];
    }
    let step = (w.max(h) / 64).max(1);
    let mut counts = [0u32; 12];
    let mut total = 0u32;
    for y in (0..h).step_by(step as usize) {
        for x in (0..w).step_by(step as usize) {
            let p = im.get_pixel(x, y);
            if p[3] < 128 {
                continue;
            }
            total += 1;
            counts[color_bucket(p[0], p[1], p[2])] += 1;
        }
    }
    if total == 0 {
        return vec![];
    }
    let mut order: Vec<usize> = (0..12).filter(|i| counts[*i] > 0).collect();
    order.sort_by_key(|i| std::cmp::Reverse(counts[*i]));
    let mut out: Vec<String> = order.iter().filter(|i| counts[**i] as f64 / total as f64 >= 0.12).take(4).map(|i| COLORS[*i].0.to_owned()).collect();
    if out.is_empty() {
        out.push(COLORS[order[0]].0.to_owned());
    }
    // w kolejności palety (stabilny zapis)
    out.sort_by_key(|k| COLORS.iter().position(|(c, _)| c == k));
    out
}

/// Indeks koloru z `COLORS` dla piksela (HSV: czerń i biel po jasności, szarość po nasyceniu, reszta po barwie)
fn color_bucket(r: u8, g: u8, b: u8) -> usize {
    let (rf, gf, bf) = (f32::from(r) / 255.0, f32::from(g) / 255.0, f32::from(b) / 255.0);
    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let d = max - min;
    let (v, s) = (max, if max == 0.0 { 0.0 } else { d / max });
    if v < 0.16 {
        return 11; // czarny
    }
    if s < 0.14 {
        return if v > 0.85 { 9 } else { 10 }; // biały / szary
    }
    let mut hue = if d == 0.0 {
        0.0
    } else if max == rf {
        60.0 * (((gf - bf) / d) % 6.0)
    } else if max == gf {
        60.0 * ((bf - rf) / d + 2.0)
    } else {
        60.0 * ((rf - gf) / d + 4.0)
    };
    if hue < 0.0 {
        hue += 360.0;
    }
    match hue {
        h if !(15.0..345.0).contains(&h) => if v < 0.45 { 8 } else { 0 }, // czerwony (ciemny = brązowy)
        h if h < 40.0 => if v < 0.62 { 8 } else { 1 },                    // pomarańczowy / brązowy
        h if h < 70.0 => 2,
        h if h < 165.0 => 3,
        h if h < 200.0 => 4,
        h if h < 255.0 => 5,
        h if h < 300.0 => 6,
        _ => 7,
    }
}

/// Dostępność kosmetyku w sklepie dla zwykłego gracza
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Avail {
    Open,
    /// kosmetyk zdobywa się inaczej niż w sklepie (widoczny tylko dla admina)
    NotInShop,
    Disabled,
    /// przed początkiem sprzedaży / po jej końcu
    NotYet,
    Ended,
    SoldOut,
}

impl Avail {
    pub fn key(self) -> &'static str {
        match self {
            Avail::Open => "open",
            Avail::NotInShop => "hidden",
            Avail::Disabled => "disabled",
            Avail::NotYet => "soon",
            Avail::Ended => "ended",
            Avail::SoldOut => "soldout",
        }
    }
}

/// Czy można teraz kupić: w sklepie, włączony, w oknie sprzedaży i są jeszcze sztuki
pub fn availability(c: &Cosmetic, now: f64, sold: i64) -> Avail {
    if !c.in_shop {
        Avail::NotInShop
    } else if !c.enabled {
        Avail::Disabled
    } else if c.sale_from.is_some_and(|t| now < t) {
        Avail::NotYet
    } else if c.sale_to.is_some_and(|t| now > t) {
        Avail::Ended
    } else if c.stock.is_some_and(|s| sold >= i64::from(s)) {
        Avail::SoldOut
    } else {
        Avail::Open
    }
}

/// Dlaczego zakup się nie uda (None = można). Admin kupuje też to, co ukryte, wyłączone albo poza terminem (testy, jak skrzynki), ale limit sztuk
/// obowiązuje wszystkich.
pub fn purchase_problem(c: &Cosmetic, avail: Avail, admin: bool, owned: bool, euro: i64) -> Option<&'static str> {
    if owned {
        return Some("Już masz ten kosmetyk");
    }
    if c.price <= 0 {
        return Some("Ten kosmetyk nie ma jeszcze ceny");
    }
    match avail {
        Avail::SoldOut => return Some("Ten kosmetyk jest wyprzedany"),
        Avail::Open => {}
        _ if admin => {}
        Avail::NotInShop | Avail::Disabled => return Some("Tego kosmetyku nie ma w sklepie"),
        Avail::NotYet => return Some("Sprzedaż tego kosmetyku jeszcze się nie zaczęła"),
        Avail::Ended => return Some("Sprzedaż tego kosmetyku już się skończyła"),
    }
    if euro < c.price {
        return Some("Za mało euro");
    }
    None
}

impl Cosmetic {
    pub fn url(&self) -> String {
        format!("/cosmetic/{}?v={}", self.id, self.img_at as i64)
    }

    /// Pozycja dla przeglądarki (bez informacji, czy gracz ją ma)
    pub fn view(&self) -> Value {
        json!({"id": self.id, "kind": self.kind.key(), "name": self.name, "url": self.url(), "animated": self.animated})
    }
}

/// Własne zdjęcia profilowe w użyciu: gracz -> id kosmetyku (w pamięci, bo `User::view` jest synchroniczne i woła się wszędzie, gdzie widać nazwę gracza)
static AVATARS: LazyLock<RwLock<std::collections::HashMap<i64, String>>> = LazyLock::new(|| RwLock::new(std::collections::HashMap::new()));

/// Adres własnego zdjęcia profilowego gracza (tylko jeśli kosmetyk istnieje, jest włączony i jest rodzaju `avatar`)
pub fn avatar_url(uid: i64) -> Option<String> {
    let id = AVATARS.read().get(&uid).cloned()?;
    get(&id).filter(|c| c.enabled && c.kind == Kind::Avatar).map(|c| c.url())
}

/// Zmiana zdjęcia profilowego gracza (puste id = zdjęcie z karty albo litera)
pub fn set_avatar(uid: i64, id: &str) {
    let mut m = AVATARS.write();
    if id.is_empty() {
        m.remove(&uid);
    } else {
        m.insert(uid, id.to_owned());
    }
}

static REGISTRY: LazyLock<RwLock<Arc<Vec<Cosmetic>>>> = LazyLock::new(|| RwLock::new(Arc::new(vec![])));

/// Cały katalog (migawka), posortowany: rodzaj, kolejność, nazwa
pub fn list() -> Arc<Vec<Cosmetic>> {
    REGISTRY.read().clone()
}

pub fn get(id: &str) -> Option<Cosmetic> {
    list().iter().find(|c| c.id == id).cloned()
}

pub fn exists(id: &str) -> bool {
    list().iter().any(|c| c.id == id)
}

/// Ładuje katalog z bazy do pamięci procesu (start i po każdej zmianie z panelu)
pub async fn reload(c: &mut Conn) -> sqlx::Result<()> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT id, kind, name, source, auto, enabled, hide_locked, pos, mime, w, h, animated, img_at, price, in_shop, tags, stock, sale_from, sale_to \
         FROM cosmetics ORDER BY pos, name, id",
    )
    .fetch_all(&mut *c)
    .await?;
    let mut all: Vec<Cosmetic> = rows
        .iter()
        .filter_map(|r| {
            Some(Cosmetic {
                id: r.get("id"),
                kind: Kind::from_key(&r.get::<String, _>("kind"))?,
                name: r.get("name"),
                source: r.get("source"),
                auto: r.get("auto"),
                enabled: r.get::<i16, _>("enabled") != 0,
                hide_locked: r.get::<i16, _>("hide_locked") != 0,
                pos: r.get("pos"),
                mime: r.get("mime"),
                w: r.get("w"),
                h: r.get("h"),
                animated: r.get::<i16, _>("animated") != 0,
                img_at: r.get("img_at"),
                price: r.get("price"),
                in_shop: r.get::<i16, _>("in_shop") != 0,
                tags: clean_tags(&r.get::<String, _>("tags")),
                stock: r.get("stock"),
                sale_from: r.get("sale_from"),
                sale_to: r.get("sale_to"),
            })
        })
        .collect();
    all.sort_by_key(|c| (KINDS.iter().position(|k| *k == c.kind), c.pos));
    *REGISTRY.write() = Arc::new(all);
    let worn: Vec<(i64, String)> = sqlx::query_as("SELECT user_id, avatar FROM user_profile_style WHERE avatar <> ''").fetch_all(&mut *c).await?;
    *AVATARS.write() = worn.into_iter().collect();
    Ok(())
}

/// Start serwera: rejestr do pamięci
pub async fn init(c: &mut Conn) -> sqlx::Result<()> {
    reload(c).await
}

/// Odblokowuje pozycję graczowi (raz). true = nowo odblokowana. Nieznane id nic nie robi.
pub async fn unlock(c: &mut Conn, uid: i64, id: &str, source: &str) -> sqlx::Result<bool> {
    if !exists(id) {
        return Ok(false);
    }
    let n = sqlx::query("INSERT INTO user_cosmetics (user_id, cosmetic_id, source, at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING")
        .bind(uid)
        .bind(id)
        .bind(source)
        .bind(now())
        .execute(c)
        .await?
        .rows_affected();
    Ok(n == 1)
}

/// Odblokowanie samym zdarzeniem: wszystkie pozycje z danym `auto` (quest_wanted / quest_ctf / service). Zwraca nowo odblokowane id.
pub async fn grant_auto(c: &mut Conn, uid: i64, auto: &str) -> sqlx::Result<Vec<String>> {
    let mut fresh = vec![];
    for cos in list().iter().filter(|c| c.auto == auto) {
        if unlock(c, uid, &cos.id, auto).await? {
            fresh.push(cos.id.clone());
        }
    }
    Ok(fresh)
}

/// Odblokowane przez gracza id
pub async fn unlocked_of(c: &mut Conn, uid: i64) -> sqlx::Result<HashSet<String>> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT cosmetic_id FROM user_cosmetics WHERE user_id = $1").bind(uid).fetch_all(c).await?;
    Ok(rows.into_iter().collect())
}

/// Wybór gracza: (tło miniprofilu, obramówka, tło profilu, kto widzi ekwipunek)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Style {
    pub mini: String,
    pub frame: String,
    pub bg: String,
    pub avatar: String,
    pub inventory: Visibility,
    /// opis profilu (do `BIO_MAX` znaków) i kraj (kod ISO wielkimi literami jak w Paszporcie, puste = brak) - darmowe, dla każdego
    pub bio: String,
    pub country: String,
}

/// Najdłuższy opis profilu
pub const BIO_MAX: usize = 200;

impl Default for Style {
    fn default() -> Style {
        Style {
            mini: String::new(), frame: String::new(), bg: String::new(), avatar: String::new(),
            inventory: Visibility::Friends, bio: String::new(), country: String::new(),
        }
    }
}

impl Style {
    pub fn of(&self, kind: Kind) -> &str {
        match kind {
            Kind::Mini => &self.mini,
            Kind::Frame => &self.frame,
            Kind::Bg => &self.bg,
            Kind::Avatar => &self.avatar,
        }
    }

    /// Wygląd dla innych graczy: tylko pozycje, które nadal istnieją, są włączone i są właściwego rodzaju (usunięta albo wyłączona = standardowy wygląd)
    pub fn shown(&self) -> Value {
        let pick = |kind: Kind| {
            get(self.of(kind)).filter(|c| c.enabled && c.kind == kind).map_or(Value::Null, |c| c.view())
        };
        json!({"mini": pick(Kind::Mini), "frame": pick(Kind::Frame), "bg": pick(Kind::Bg), "avatar": pick(Kind::Avatar)})
    }
}

pub async fn style_of(c: &mut Conn, uid: i64) -> sqlx::Result<Style> {
    use sqlx::Row;
    let row = sqlx::query("SELECT mini_bg, frame, profile_bg, avatar, inventory_visible, bio, country FROM user_profile_style WHERE user_id = $1")
        .bind(uid)
        .fetch_optional(c)
        .await?;
    Ok(row.map_or_else(Style::default, |r| Style {
        mini: r.get("mini_bg"),
        frame: r.get("frame"),
        bg: r.get("profile_bg"),
        avatar: r.get("avatar"),
        inventory: Visibility::parse(&r.get::<String, _>("inventory_visible")),
        bio: r.get("bio"),
        country: r.get("country"),
    }))
}

/// Kto może oglądać ekwipunek gracza
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Visibility {
    Friends,
    Nobody,
}

impl Visibility {
    /// Nieznana wartość = domyślne `Friends`
    pub fn parse(s: &str) -> Visibility {
        if s == "nobody" { Visibility::Nobody } else { Visibility::Friends }
    }

    pub fn key(self) -> &'static str {
        match self {
            Visibility::Friends => "friends",
            Visibility::Nobody => "nobody",
        }
    }
}

/// Czy oglądający może zobaczyć ekwipunek gracza: sam właściciel zawsze, znajomy - gdy właściciel pozwala (domyślnie tak). Gracze poza rankingiem
/// (zablokowani, ukryci, z pieniędzmi od admina) nie pokazują ekwipunku nikomu poza sobą, żeby nie wyciekali.
pub fn inventory_allowed(setting: Visibility, relation: Relation, target_hidden: bool) -> bool {
    match relation {
        Relation::Me => true,
        Relation::Friend => setting == Visibility::Friends && !target_hidden,
        _ => false,
    }
}

/// Czy gracz może założyć pozycję: musi istnieć, być włączona, mieć właściwy rodzaj i być odblokowana
pub fn can_equip(unlocked: &HashSet<String>, cosmetic: Option<&Cosmetic>, kind: Kind) -> Result<(), &'static str> {
    let Some(c) = cosmetic else { return Err("Nie ma takiego kosmetyku") };
    if c.kind != kind {
        return Err("Ten kosmetyk jest innego rodzaju");
    }
    if !c.enabled {
        return Err("Ten kosmetyk jest wyłączony");
    }
    if !unlocked.contains(&c.id) {
        return Err("Jeszcze nie odblokowałeś tego kosmetyku");
    }
    Ok(())
}

// ---------------------------------------------------------------- obrazki

/// Obrazek po sprawdzeniu: bajty do zapisania, typ, wymiary, czy animowany
#[derive(Debug)]
pub struct Processed {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub w: u32,
    pub h: u32,
    pub animated: bool,
    /// tagi koloru wykryte na obrazku (pierwsza klatka animacji); admin może je poprawić
    pub colors: Vec<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Format {
    Png,
    Gif,
    Webp,
    Jpeg,
}

fn sniff(b: &[u8]) -> Option<Format> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(Format::Png)
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some(Format::Gif)
    } else if b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some(Format::Webp)
    } else if b.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(Format::Jpeg)
    } else {
        None
    }
}

fn is_animated(fmt: Format, b: &[u8]) -> bool {
    match fmt {
        // flaga animacji w nagłówku VP8X
        Format::Webp => b.len() > 21 && &b[12..16] == b"VP8X" && b[20] & 0x02 != 0,
        // APNG ma kawałek acTL przed danymi obrazu
        Format::Png => b.windows(4).take(4096).any(|w| w == b"acTL"),
        Format::Gif => image::codecs::gif::GifDecoder::new(Cursor::new(b)).map(|d| d.into_frames().take(2).count() > 1).unwrap_or(false),
        Format::Jpeg => false,
    }
}

/// Środek obramówki ma być przezroczysty: centralny kwadrat (30-70% boków) w co najmniej 90% bez krycia, a całość nie może być pusta
fn frame_center_clear(im: &image::RgbaImage) -> Result<(), String> {
    let (w, h) = im.dimensions();
    let (x0, x1, y0, y1) = (w * 3 / 10, w * 7 / 10, h * 3 / 10, h * 7 / 10);
    let (mut clear, mut total) = (0u32, 0u32);
    for y in y0..y1 {
        for x in x0..x1 {
            total += 1;
            if im.get_pixel(x, y)[3] < 32 {
                clear += 1;
            }
        }
    }
    if total == 0 || clear * 10 < total * 9 {
        return Err("Środek obramówki musi być przezroczysty (tam widać zdjęcie gracza)".into());
    }
    let visible = im.pixels().filter(|p| p[3] > 128).count();
    if visible * 100 < (w * h) as usize {
        return Err("Obramówka jest pusta - nic na niej nie widać".into());
    }
    Ok(())
}

/// Sprawdza wgrany plik dla rodzaju kosmetyku: rozmiar pliku, format (po nagłówku, nie po nazwie), DOKŁADNE wymiary, a dla obramówki
/// przezroczysty środek. Statyczne obrazki zamienia na WebP, animacje zostawia bez zmian.
pub fn process_image(kind: Kind, blob: &[u8]) -> Result<Processed, String> {
    if blob.is_empty() {
        return Err("Wybierz plik z grafiką".into());
    }
    if blob.len() > kind.max_bytes() {
        return Err(format!("Plik jest za duży (najwyżej {} KB)", kind.max_bytes() / 1024));
    }
    let fmt = sniff(blob).ok_or("To nie jest obrazek PNG, WebP, GIF ani JPEG")?;
    let (w, h) = ImageReader::new(Cursor::new(blob))
        .with_guessed_format()
        .map_err(|_| "Nie udało się odczytać obrazka".to_owned())?
        .into_dimensions()
        .map_err(|_| "Nie udało się odczytać obrazka".to_owned())?;
    let (need_w, need_h) = kind.size();
    if (w, h) != (need_w, need_h) {
        return Err(format!("{}: wymagane dokładnie {need_w} × {need_h} px, a plik ma {w} × {h} px", kind.label()));
    }
    if is_animated(fmt, blob) {
        let mime = match fmt {
            Format::Gif => "image/gif",
            Format::Png => "image/png",
            _ => "image/webp",
        };
        // kolory z pierwszej klatki (gdy się nie da jej odczytać - bez tagów, admin dopisze ręcznie)
        let colors = crate::images::decode(blob).map(|im| detect_colors(&im.to_rgba8())).unwrap_or_default();
        return Ok(Processed { bytes: blob.to_vec(), mime, w, h, animated: true, colors });
    }
    let im = crate::images::decode(blob)?;
    if kind == Kind::Frame {
        frame_center_clear(&im.to_rgba8())?;
    }
    let colors = detect_colors(&im.to_rgba8());
    let bytes = crate::images::to_webp(blob)?;
    Ok(Processed { bytes, mime: "image/webp", w, h, animated: false, colors })
}

/// Lista do formularzy nagród w panelu admina (osiągnięcia, kalendarz adwentowy, Paszport, nagrody leveli)
pub fn options() -> Vec<Value> {
    list().iter().map(|c| json!({"id": c.id, "name": c.name, "kind": c.kind.key(), "kindLabel": c.kind.label()})).collect()
}

// ---------------------------------------------------------------- testy

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};

    fn png(w: u32, h: u32, f: impl Fn(u32, u32) -> Rgba<u8>) -> Vec<u8> {
        let mut im = RgbaImage::new(w, h);
        for (x, y, p) in im.enumerate_pixels_mut() {
            *p = f(x, y);
        }
        let mut out = Cursor::new(vec![]);
        DynamicImage::ImageRgba8(im).write_to(&mut out, ImageFormat::Png).unwrap();
        out.into_inner()
    }

    fn cosmetic(id: &str, kind: Kind, enabled: bool) -> Cosmetic {
        Cosmetic {
            id: id.into(), kind, name: id.into(), source: String::new(), auto: String::new(), enabled, hide_locked: false, pos: 0,
            mime: "image/webp".into(), w: 1, h: 1, animated: false, img_at: 1.0, price: 100, in_shop: true, tags: vec![], stock: None,
            sale_from: None, sale_to: None,
        }
    }

    #[test]
    fn dimensions_are_enforced_per_kind() {
        let solid = |_: u32, _: u32| Rgba([200, 30, 30, 255]);
        let ok = process_image(Kind::Bg, &png(1600, 900, solid)).unwrap();
        assert_eq!((ok.w, ok.h, ok.animated, ok.mime), (1600, 900, false, "image/webp"));
        assert!(process_image(Kind::Bg, &png(1600, 899, solid)).unwrap_err().contains("1600 × 900"));
        assert!(process_image(Kind::Mini, &png(1600, 900, solid)).is_err());
        assert!(process_image(Kind::Mini, &png(600, 400, solid)).is_ok());
        assert!(process_image(Kind::Frame, &png(256, 256, solid)).is_err(), "pełny kwadrat nie ma przezroczystego środka");
    }

    #[test]
    fn frame_needs_transparent_center() {
        let ring = |x: u32, y: u32| {
            let (dx, dy) = (x as f32 - 127.5, y as f32 - 127.5);
            if (dx * dx + dy * dy).sqrt() > 100.0 { Rgba([255, 200, 0, 255]) } else { Rgba([0, 0, 0, 0]) }
        };
        assert!(process_image(Kind::Frame, &png(256, 256, ring)).is_ok());
        assert!(process_image(Kind::Frame, &png(256, 256, |_, _| Rgba([0, 0, 0, 0]))).unwrap_err().contains("pusta"));
    }

    #[test]
    fn rejects_garbage_and_oversize() {
        assert!(process_image(Kind::Mini, b"to nie obrazek").is_err());
        assert!(process_image(Kind::Mini, &[]).is_err());
        let big = vec![0x89u8; Kind::Frame.max_bytes() + 1];
        assert!(process_image(Kind::Frame, &big).unwrap_err().contains("za duży"));
    }

    #[test]
    fn animated_gif_is_kept_static_gif_becomes_webp() {
        use image::codecs::gif::GifEncoder;
        use image::Frame;
        let frame = |c: [u8; 4]| Frame::new(RgbaImage::from_pixel(600, 400, Rgba(c)));
        let encode = |frames: Vec<Frame>| {
            let mut out = vec![];
            {
                let mut enc = GifEncoder::new(&mut out);
                enc.encode_frames(frames).unwrap();
            }
            out
        };
        let animated = encode(vec![frame([255, 0, 0, 255]), frame([0, 0, 255, 255])]);
        let p = process_image(Kind::Mini, &animated).unwrap();
        assert!(p.animated && p.mime == "image/gif" && p.bytes == animated, "animacja zostaje bez zmian");
        let still = encode(vec![frame([0, 255, 0, 255])]);
        let p = process_image(Kind::Mini, &still).unwrap();
        assert!(!p.animated && p.mime == "image/webp", "jedna klatka = zwykły obrazek");
        // zły rozmiar animacji też jest odrzucany
        let wrong = encode(vec![Frame::new(RgbaImage::new(10, 10)), Frame::new(RgbaImage::new(10, 10))]);
        assert!(process_image(Kind::Mini, &wrong).is_err());
    }

    #[test]
    fn webp_animation_flag_is_read_from_header() {
        let mut anim = b"RIFF\x1a\0\0\0WEBPVP8X\x0a\0\0\0".to_vec();
        anim.extend_from_slice(&[0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert!(is_animated(Format::Webp, &anim));
        anim[20] = 0;
        assert!(!is_animated(Format::Webp, &anim));
        assert_eq!(sniff(&anim), Some(Format::Webp));
    }

    #[test]
    fn kinds_have_distinct_keys() {
        let keys: HashSet<_> = KINDS.iter().map(|k| k.key()).collect();
        assert_eq!(keys.len(), 4);
        assert_eq!(Kind::from_key("frame"), Some(Kind::Frame));
        assert_eq!(Kind::from_key("x"), None);
    }

    #[test]
    fn equip_only_unlocked_enabled_matching() {
        let have: HashSet<String> = ["a".to_owned(), "off".to_owned()].into();
        let a = cosmetic("a", Kind::Frame, true);
        assert!(can_equip(&have, Some(&a), Kind::Frame).is_ok());
        assert!(can_equip(&have, Some(&a), Kind::Bg).is_err(), "zły rodzaj");
        assert!(can_equip(&have, Some(&cosmetic("b", Kind::Frame, true)), Kind::Frame).is_err(), "niewłasny");
        assert!(can_equip(&have, Some(&cosmetic("off", Kind::Frame, false)), Kind::Frame).is_err(), "wyłączony");
        assert!(can_equip(&have, None, Kind::Frame).is_err(), "nieistniejący");
    }

    #[test]
    fn inventory_privacy() {
        use Visibility::*;
        assert!(inventory_allowed(Friends, Relation::Friend, false), "domyślnie znajomi widzą");
        assert!(!inventory_allowed(Nobody, Relation::Friend, false), "ukryty przed znajomymi");
        assert!(!inventory_allowed(Friends, Relation::None, false), "obcy nie widzi");
        assert!(!inventory_allowed(Friends, Relation::Incoming, false) && !inventory_allowed(Friends, Relation::Outgoing, false));
        assert!(inventory_allowed(Nobody, Relation::Me, false), "swój zawsze");
        assert!(!inventory_allowed(Friends, Relation::Friend, true), "gracz poza rankingiem nie wycieka");
        assert_eq!(Visibility::parse("cokolwiek"), Friends);
        assert_eq!(Visibility::parse("nobody"), Nobody);
    }

    fn solid(w: u32, h: u32, c: [u8; 4]) -> RgbaImage {
        RgbaImage::from_pixel(w, h, Rgba(c))
    }

    #[test]
    fn colors_are_detected_as_tags() {
        assert_eq!(detect_colors(&solid(200, 100, [220, 30, 30, 255])), vec!["red"]);
        assert_eq!(detect_colors(&solid(200, 100, [30, 90, 230, 255])), vec!["blue"]);
        assert_eq!(detect_colors(&solid(200, 100, [250, 250, 250, 255])), vec!["white"]);
        assert_eq!(detect_colors(&solid(200, 100, [5, 5, 5, 255])), vec!["black"]);
        assert_eq!(detect_colors(&solid(200, 100, [250, 120, 10, 255])), vec!["orange"]);
        assert_eq!(detect_colors(&solid(200, 100, [255, 60, 190, 255])), vec!["pink"]);
        // dwa kolory po pół obrazka = dwa tagi (w kolejności palety), przezroczystość się nie liczy
        let mut two = solid(200, 100, [0, 200, 60, 255]);
        for y in 0..100 {
            for x in 100..200 {
                two.put_pixel(x, y, Rgba([160, 40, 220, 255]));
            }
        }
        assert_eq!(detect_colors(&two), vec!["green", "purple"]);
        let mut ring = solid(256, 256, [0, 0, 0, 0]);
        for x in 0..256 {
            ring.put_pixel(x, 0, Rgba([255, 200, 0, 255]));
        }
        assert_eq!(detect_colors(&ring), vec!["yellow"], "tylko widoczne piksele");
        assert!(detect_colors(&solid(10, 10, [9, 9, 9, 0])).is_empty());
        assert_eq!(clean_tags("red, blue,zzz,red;pink"), vec!["red", "blue", "pink"]);
    }

    #[test]
    fn shop_availability_and_purchase_rules() {
        let mut c = cosmetic("a", Kind::Frame, true);
        let now = 1000.0;
        assert_eq!(availability(&c, now, 0), Avail::Open);
        assert_eq!(purchase_problem(&c, Avail::Open, false, false, 100), None);
        assert!(purchase_problem(&c, Avail::Open, false, false, 99).is_some(), "za mało euro");
        assert!(purchase_problem(&c, Avail::Open, false, true, 999).is_some(), "już ma");
        c.in_shop = false;
        let a = availability(&c, now, 0);
        assert_eq!(a, Avail::NotInShop);
        assert!(purchase_problem(&c, a, false, false, 999).is_some(), "ukryty: nie dla gracza");
        assert!(purchase_problem(&c, a, true, false, 999).is_none(), "ukryty: admin kupuje (testy)");
        c.in_shop = true;
        c.sale_from = Some(2000.0);
        assert_eq!(availability(&c, now, 0), Avail::NotYet);
        c.sale_from = None;
        c.sale_to = Some(500.0);
        assert_eq!(availability(&c, now, 0), Avail::Ended);
        c.sale_to = None;
        c.stock = Some(3);
        assert_eq!(availability(&c, now, 2), Avail::Open);
        let a = availability(&c, now, 3);
        assert_eq!(a, Avail::SoldOut);
        assert!(purchase_problem(&c, a, true, false, 999).is_some(), "limit sztuk obowiązuje też admina");
        c.stock = None;
        c.price = 0;
        assert!(purchase_problem(&c, Avail::Open, true, false, 999).is_some(), "bez ceny nie da się kupić");
    }

    #[test]
    fn hidden_or_disabled_cosmetics_fall_back_to_default() {
        // pusty rejestr: nic nie jest widoczne, nawet gdy gracz ma zapisany wybór
        let style = Style { mini: "x".into(), frame: "y".into(), bg: "z".into(), avatar: "w".into(), ..Style::default() };
        let v = style.shown();
        assert!(v["mini"].is_null() && v["frame"].is_null() && v["bg"].is_null() && v["avatar"].is_null());
    }
}
