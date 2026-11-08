//! Zdjęcia kart (port images.py): Wikipedia (główne), Wikimedia Commons / inne Wikipedie (alternatywne),
//! upload i URL z panelu admina (z kadrowaniem), wszystkie rastrowe zdjęcia trzymane jako WebP, flagi krajów z flagcdn.com.

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use image::{AnimationDecoder, DynamicImage, ImageDecoder, ImageReader};
use parking_lot::Mutex;
use regex::Regex;
use serde_json::Value;

use crate::db::now;

const USER_AGENT: &str = "CelebCrates/1.0 (private hobby project; rust-reqwest)";
const THUMB_SIZE: u32 = 500;
/// Dłuższy bok zapisanego zdjęcia (większe są zmniejszane, mniejszych nie powiększamy)
pub const MAX_SIDE: u32 = 1600;
const QUALITY: f32 = 85.0;
const QUALITY_ALPHA: f32 = 92.0;
/// Limit pobierania zdjęcia z linku
const MAX_REMOTE: usize = 10 * 1024 * 1024;
const MIN_CROP_PX: u32 = 32;
pub const MAX_UPLOAD: usize = 8 * 1024 * 1024;
// webp pierwszy: gdy obok leży stary plik w innym formacie (przed migracją), wygrywa WebP
const EXTS: [(&str, &str); 4] = [("webp", "image/webp"), ("jpg", "image/jpeg"), ("png", "image/png"), ("gif", "image/gif")];
/// Rozszerzenia, które migracja przy starcie zamienia na .webp
const LEGACY_EXTS: [&str; 5] = ["jpg", "jpeg", "png", "gif", "bmp"];
const BAD_WORDS: &[&str] = &[
    "signature",
    "podpis",
    "logo",
    "coat",
    "herb",
    "flag",
    "flaga",
    "map",
    "mapa",
    "autograph",
    "grave",
    "grób",
    "tomb",
    "stamp",
    "coin",
    "banknote",
    "plaque",
    "tablica",
    "poster",
    "plakat",
    "document",
    "dokument",
    "letter",
    "scan",
    "page",
    "strona",
    "certificate",
    "akt ",
    "book",
    "ksiega",
    "księga",
    "newspaper",
    "gazeta",
    "family",
    "rodzin",
    "house",
    "dom ",
    "church",
    "kości",
    "monument",
    "pomnik",
    "statue",
    "mural",
    "painting",
    "obraz",
    "car ",
    "plane",
    "samolot",
];
const ALT_LANGS: &[&str] = &["en", "pl", "de", "fr", "es", "it", "ru", "uk", "cs", "nl", "pt", "sv", "fi", "hu"];
static FLAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z]{2}(-[a-z0-9]{1,3})?$").unwrap());

/// Które zdjęcie karty: główne, alternatywne albo własne zdjęcie wariantu (np. "rzulty")
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Kind {
    Main,
    Alt,
    Variant(String),
}

impl Kind {
    fn suffix(&self) -> String {
        match self {
            Kind::Main => String::new(),
            Kind::Alt => "__alt".into(),
            Kind::Variant(v) => format!("__{v}"),
        }
    }
}

pub struct Images {
    pub cache_dir: PathBuf,
    http: reqwest::Client,
    failed: Mutex<HashMap<(String, Kind), f64>>,
    flag_failed: Mutex<HashMap<String, f64>>,
    fetch_lock: tokio::sync::Mutex<()>,
}

pub fn mimetype(path: &Path) -> &'static str {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    EXTS.iter().find(|(e, _)| *e == ext).map(|(_, m)| *m).unwrap_or("image/jpeg")
}

pub fn sniff(blob: &[u8]) -> Option<&'static str> {
    if blob.starts_with(b"\xff\xd8\xff") {
        Some("jpg")
    } else if blob.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if blob.len() >= 12 && &blob[..4] == b"RIFF" && &blob[8..12] == b"WEBP" {
        Some("webp")
    } else if blob.starts_with(b"GIF87a") || blob.starts_with(b"GIF89a") {
        Some("gif")
    } else {
        None
    }
}

fn norm(name: &str) -> String {
    name.replace('_', " ").replace("File:", "").replace("Plik:", "").trim().to_lowercase()
}

fn usable(fname: &str) -> bool {
    let n = norm(fname);
    [".jpg", ".jpeg", ".png", ".webp"].iter().any(|e| n.ends_with(e)) && !BAD_WORDS.iter().any(|b| n.contains(b))
}

fn mtime(path: &Path) -> Option<f64> {
    std::fs::metadata(path).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs_f64())
}

/// Wersja zdjęcia (czas pliku) - do adresów ?v=
pub fn file_mtime(path: &Path) -> f64 {
    mtime(path).unwrap_or(0.0)
}

impl Images {
    pub fn new(data_dir: &Path) -> Self {
        let http = reqwest::Client::builder().user_agent(USER_AGENT).timeout(Duration::from_secs(20)).build().expect("http");
        Images {
            cache_dir: data_dir.join("image_cache"),
            http,
            failed: Mutex::default(),
            flag_failed: Mutex::default(),
            fetch_lock: tokio::sync::Mutex::new(()),
        }
    }

    fn stem(&self, pid: &str, kind: &Kind) -> PathBuf {
        self.cache_dir.join(format!("{pid}{}", kind.suffix()))
    }

    /// Ścieżka do zapisanego zdjęcia albo None
    pub fn find(&self, pid: &str, kind: &Kind) -> Option<PathBuf> {
        if pid.contains('/') || pid.contains('\\') || pid.contains("..") {
            return None;
        }
        let stem = self.stem(pid, kind);
        EXTS.iter().map(|(e, _)| PathBuf::from(format!("{}.{e}", stem.display()))).find(|p| p.exists())
    }

    // ------------------------------------------------------------ zapis / usuwanie

    /// Zapis wgranego pliku: dowolny obsługiwany obrazek trafia do image_cache jako WebP (animowany GIF zostaje GIF-em)
    pub fn save(&self, pid: &str, blob: &[u8], kind: &Kind) -> Result<(), String> {
        self.save_cropped(pid, blob, kind, None)
    }

    /// Jak `save`, ale najpierw wycina kadr (ułamki oryginału); kadrowany obraz jest zawsze statyczny
    pub fn save_cropped(&self, pid: &str, blob: &[u8], kind: &Kind, crop: Option<Crop>) -> Result<(), String> {
        if blob.len() > MAX_UPLOAD {
            return Err("Plik jest za duży (max 8 MB)".into());
        }
        self.store(pid, blob, kind, crop)
    }

    fn store(&self, pid: &str, blob: &[u8], kind: &Kind, crop: Option<Crop>) -> Result<(), String> {
        let ext = sniff(blob).ok_or("To nie jest obsługiwany obrazek (JPG, PNG, WEBP, GIF)")?;
        let animated = ext == "gif" && is_animated_gif(blob);
        let (ext, data) = if animated && crop.is_none() {
            ("gif", blob.to_vec())
        } else if let (true, Some(c)) = (animated, crop) {
            ("gif", crop_gif(blob, c)?) // kadrowany animowany GIF zostaje animowanym GIF-em
        } else {
            ("webp", process(blob, crop)?)
        };
        std::fs::create_dir_all(&self.cache_dir).map_err(|e| e.to_string())?;
        self.delete(pid, kind);
        let target = format!("{}.{ext}", self.stem(pid, kind).display());
        let tmp = format!("{target}.tmp");
        std::fs::write(&tmp, &data).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
        self.failed.lock().remove(&(pid.to_owned(), kind.clone()));
        Ok(())
    }

    /// Zdjęcie pobrane z Wikipedii: obok pliku znacznik `<plik>.wiki` - eksport (`export-catalog`) pomija takie zdjęcia,
    /// bo każda instalacja pobierze je sama. Każdy inny zapis (`store` -> `delete`) usuwa znacznik.
    fn save_wiki(&self, pid: &str, blob: &[u8], kind: &Kind) -> Result<(), String> {
        self.store(pid, blob, kind, None)?;
        let _ = std::fs::write(self.wiki_marker(pid, kind), b"");
        Ok(())
    }

    fn wiki_marker(&self, pid: &str, kind: &Kind) -> PathBuf {
        PathBuf::from(format!("{}.wiki", self.stem(pid, kind).display()))
    }

    /// Czy zapisane zdjęcie pochodzi z Wikipedii (a nie z panelu admina)
    pub fn is_from_wiki(&self, pid: &str, kind: &Kind) -> bool {
        self.wiki_marker(pid, kind).exists()
    }

    pub async fn save_url(&self, pid: &str, url: &str, kind: &Kind) -> Result<(), String> {
        self.save_url_cropped(pid, url, kind, None).await
    }

    /// Zdjęcie z linku (z ochroną SSRF, patrz `fetch_remote`), opcjonalnie z kadrem
    pub async fn save_url_cropped(&self, pid: &str, url: &str, kind: &Kind, crop: Option<Crop>) -> Result<(), String> {
        let blob = fetch_remote(url.trim()).await?;
        self.store(pid, &blob, kind, crop)
    }

    pub fn delete(&self, pid: &str, kind: &Kind) {
        for (e, _) in EXTS {
            let _ = std::fs::remove_file(format!("{}.{e}", self.stem(pid, kind).display()));
        }
        let _ = std::fs::remove_file(self.wiki_marker(pid, kind));
    }

    /// Usuwa pliki <pid>__<nazwa>.* poza nazwami z keep (np. wgrane naklejki wariantu, których admin nie zapisał)
    pub fn delete_other(&self, pid: &str, keep: &std::collections::HashSet<String>) {
        let prefix = format!("{pid}__");
        let Ok(dir) = std::fs::read_dir(&self.cache_dir) else { return };
        for entry in dir.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(rest) = name.strip_prefix(&prefix) else { continue };
            let stem = rest.rsplit_once('.').map_or(rest, |(s, _)| s);
            if !keep.contains(stem) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    // ------------------------------------------------------------ pobieranie

    /// GET z ponawianiem przy 429 (Wikimedia ogranicza tempo pobierania)
    async fn get(&self, url: &str, retries: u32) -> anyhow::Result<Vec<u8>> {
        for attempt in 0..retries {
            let resp = self.http.get(url).send().await?;
            if resp.status().as_u16() == 429 && attempt + 1 < retries {
                tokio::time::sleep(Duration::from_secs(3 * 2u64.pow(attempt))).await;
                continue;
            }
            return Ok(resp.error_for_status()?.bytes().await?.to_vec());
        }
        anyhow::bail!("za dużo prób")
    }

    async fn api(&self, base: &str, params: &[(&str, String)]) -> anyhow::Result<Value> {
        let query = {
            let mut q = form_urlencoded::Serializer::new(String::new());
            for (k, v) in params {
                q.append_pair(k, v);
            }
            q.append_pair("format", "json");
            q.finish()
        };
        let blob = self.get(&format!("{base}?{query}"), 4).await?;
        Ok(serde_json::from_slice(&blob)?)
    }

    /// Strony Wikipedii dla tytułów (z przekierowaniami): {tytuł z karty: strona}
    async fn query_pages(&self, lang: &str, titles: &[String], props: &[(&str, &str)]) -> anyhow::Result<HashMap<String, Value>> {
        let mut params: Vec<(&str, String)> = vec![
            ("action", "query".into()),
            ("formatversion", "2".into()),
            ("redirects", "1".into()),
            ("titles", titles.join("|")),
        ];
        params.extend(props.iter().map(|(k, v)| (*k, v.to_string())));
        let res = self.api(&format!("https://{lang}.wikipedia.org/w/api.php"), &params).await?;
        let q = &res["query"];
        let mut alias: Vec<(String, String)> = titles.iter().map(|t| (t.clone(), t.clone())).collect();
        for key in ["normalized", "redirects"] {
            for m in q[key].as_array().into_iter().flatten() {
                let (from, to) = (m["from"].as_str().unwrap_or(""), m["to"].as_str().unwrap_or(""));
                for (_, cur) in alias.iter_mut() {
                    if cur == from {
                        *cur = to.to_owned();
                    }
                }
            }
        }
        let by_title: HashMap<&str, &Value> =
            q["pages"].as_array().into_iter().flatten().filter_map(|p| Some((p["title"].as_str()?, p))).collect();
        Ok(alias
            .into_iter()
            .map(|(orig, fin)| (orig, by_title.get(fin.as_str()).map(|v| (*v).clone()).unwrap_or(Value::Null)))
            .collect())
    }

    /// Pobiera brakujące główne zdjęcia z Wikipedii. people: (id, (język, tytuł artykułu)). Zwraca {id: udało się}.
    pub async fn fetch(&self, people: &[(String, Option<(String, String)>)], force: bool) -> HashMap<String, bool> {
        let _ = std::fs::create_dir_all(&self.cache_dir);
        let mut results = HashMap::new();
        let mut by_lang: Vec<(String, Vec<(String, String)>)> = vec![];
        for (pid, wiki) in people {
            if !force && self.find(pid, &Kind::Main).is_some() {
                results.insert(pid.clone(), true);
                continue;
            }
            let Some((lang, title)) = wiki.clone().filter(|(_, t)| !t.is_empty()) else {
                results.insert(pid.clone(), false);
                continue;
            };
            match by_lang.iter_mut().find(|(l, _)| *l == lang) {
                Some((_, items)) => items.push((pid.clone(), title)),
                None => by_lang.push((lang, vec![(pid.clone(), title)])),
            }
        }
        for (lang, items) in by_lang {
            for chunk in items.chunks(50) {
                let titles: Vec<String> = chunk.iter().map(|(_, t)| t.clone()).collect();
                let pages = self
                    .query_pages(&lang, &titles, &[("prop", "pageimages"), ("piprop", "thumbnail"), ("pithumbsize", "500")])
                    .await
                    .unwrap_or_else(|e| {
                        tracing::warn!("[zdjęcia] błąd API ({lang}): {e}");
                        HashMap::new()
                    });
                for (pid, title) in chunk {
                    let src = pages.get(title).and_then(|p| p["thumbnail"]["source"].as_str()).map(str::to_owned);
                    let mut ok = false;
                    if let Some(src) = src {
                        match self.get(&src, 4).await.map_err(|e| e.to_string()).and_then(|b| self.save_wiki(pid, &b, &Kind::Main)) {
                            Ok(()) => {
                                ok = true;
                                tokio::time::sleep(Duration::from_millis(300)).await;
                            }
                            Err(e) => tracing::warn!("[zdjęcia] nie udało się pobrać {pid}: {e}"),
                        }
                    } else {
                        tracing::info!("[zdjęcia] brak zdjęcia w artykule: {lang}:{title}");
                    }
                    results.insert(pid.clone(), ok);
                    if !ok {
                        self.failed.lock().insert((pid.clone(), Kind::Main), now());
                    }
                }
            }
        }
        results
    }

    /// Ścieżka do zdjęcia (alternatywne wraca do głównego) albo None - brakujące główne pobiera z Wikipedii
    pub async fn ensure(&self, pid: &str, wiki: Option<(String, String)>, alt: bool) -> Option<PathBuf> {
        if alt {
            if let Some(p) = self.find(pid, &Kind::Alt) {
                return Some(p);
            }
        }
        if let Some(p) = self.find(pid, &Kind::Main) {
            return Some(p);
        }
        let last = self.failed.lock().get(&(pid.to_owned(), Kind::Main)).copied().unwrap_or(0.0);
        if now() - last < 300.0 {
            return None;
        }
        {
            let _guard = self.fetch_lock.lock().await;
            if self.find(pid, &Kind::Main).is_none() {
                self.fetch(&[(pid.to_owned(), wiki)], false).await;
            }
        }
        self.find(pid, &Kind::Main)
    }

    /// Wszystkie brakujące zdjęcia (w tle, przy starcie)
    pub async fn prefetch_all(self: &Arc<Self>, people: Vec<(String, Option<(String, String)>)>) {
        let res = {
            let _guard = self.fetch_lock.lock().await;
            self.fetch(&people, false).await
        };
        tracing::info!("[zdjęcia] główne: {}/{}", res.values().filter(|x| **x).count(), res.len());
    }

    // ------------------------------------------------------------ flagi krajów (wariant flagowy)

    /// Flaga kraju (kod ISO, np. "pl", "gb-eng") jako plik SVG - pobrana raz z flagcdn.com, potem z image_cache/flags.
    /// None: zły kod albo brak internetu (kolejna próba najwcześniej za 10 minut).
    pub async fn flag(&self, code: &str) -> Option<PathBuf> {
        let code = code.to_lowercase();
        if !FLAG_RE.is_match(&code) {
            return None;
        }
        let path = self.cache_dir.join("flags").join(format!("{code}.svg"));
        if path.exists() {
            return Some(path);
        }
        if now() - self.flag_failed.lock().get(&code).copied().unwrap_or(0.0) < 600.0 {
            return None;
        }
        let blob =
            match tokio::time::timeout(Duration::from_secs(10), self.get(&format!("https://flagcdn.com/{code}.svg"), 2)).await {
                Ok(Ok(b)) => b,
                _ => {
                    self.flag_failed.lock().insert(code, now());
                    return None;
                }
            };
        let head = &blob[..blob.len().min(3000)];
        if !head.windows(4).any(|w| w == b"<svg") {
            self.flag_failed.lock().insert(code, now());
            return None;
        }
        std::fs::create_dir_all(path.parent()?).ok()?;
        std::fs::write(&path, &blob).ok()?;
        Some(path)
    }

    // ------------------------------------------------------------ zdjęcie alternatywne (komenda fetch-images)
    // Źródła (po kolei): dodatkowe zdjęcia z Wikidata (P18), potem zdjęcia główne artykułów o tej osobie w innych
    // wersjach językowych Wikipedii - wszystkie to portrety tej osoby.

    fn alt_missing_file(&self) -> PathBuf {
        self.cache_dir.join("alt_missing.json")
    }

    /// Szuka drugiego (innego niż główne) zdjęcia osoby. Zwraca liczbę nowych zdjęć.
    pub async fn fetch_alt(&self, people: &[(String, Option<(String, String)>)], force: bool) -> usize {
        let mut missing: HashSet<String> = if force {
            HashSet::new()
        } else {
            std::fs::read_to_string(self.alt_missing_file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
        };
        let wiki: HashMap<&String, &(String, String)> =
            people.iter().filter_map(|(p, w)| w.as_ref().filter(|w| !w.1.is_empty()).map(|w| (p, w))).collect();
        let todo: Vec<&String> = people
            .iter()
            .map(|(p, _)| p)
            .filter(|p| wiki.contains_key(p) && (force || (self.find(p, &Kind::Alt).is_none() && !missing.contains(*p))))
            .collect();
        if todo.is_empty() {
            return 0;
        }
        let (mut lead, mut qid, mut failed) = (HashMap::new(), Vec::<(String, String)>::new(), HashSet::new());

        // 1. główne zdjęcie i identyfikator Wikidata
        let mut by_lang: Vec<(String, Vec<(String, String)>)> = vec![];
        for pid in &todo {
            let (lang, title) = wiki[*pid].clone();
            match by_lang.iter_mut().find(|(l, _)| *l == lang) {
                Some((_, v)) => v.push(((*pid).clone(), title)),
                None => by_lang.push((lang, vec![((*pid).clone(), title)])),
            }
        }
        for (lang, items) in &by_lang {
            for chunk in items.chunks(50) {
                let titles: Vec<String> = chunk.iter().map(|(_, t)| t.clone()).collect();
                match self.query_pages(lang, &titles, &[("prop", "pageprops|pageimages"), ("piprop", "name")]).await {
                    Ok(pages) => {
                        for (pid, title) in chunk {
                            let pg = pages.get(title).cloned().unwrap_or(Value::Null);
                            lead.insert(pid.clone(), norm(pg["pageimage"].as_str().unwrap_or("")));
                            if let Some(q) = pg["pageprops"]["wikibase_item"].as_str() {
                                qid.push((pid.clone(), q.to_owned()));
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("[zdjęcia alt] błąd API ({lang}): {e}");
                        failed.extend(chunk.iter().map(|(p, _)| p.clone()));
                    }
                }
            }
        }

        // 2. Wikidata: zdjęcia (P18) i linki do innych wersji językowych
        let mut cands: HashMap<String, Vec<String>> = todo.iter().map(|p| ((*p).clone(), vec![])).collect();
        let mut sitelinks: HashMap<String, HashMap<String, String>> = HashMap::new();
        let ids: Vec<String> = qid.iter().map(|(_, q)| q.clone()).collect();
        for chunk in ids.chunks(50) {
            let sitefilter = ALT_LANGS.iter().map(|l| format!("{l}wiki")).collect::<Vec<_>>().join("|");
            let params = [
                ("action", "wbgetentities".to_owned()),
                ("props", "claims|sitelinks".to_owned()),
                ("ids", chunk.join("|")),
                ("sitefilter", sitefilter),
            ];
            let ents = match self.api("https://www.wikidata.org/w/api.php", &params).await {
                Ok(v) => v["entities"].clone(),
                Err(e) => {
                    tracing::warn!("[zdjęcia alt] błąd Wikidata: {e}");
                    failed.extend(qid.iter().filter(|(_, q)| chunk.contains(q)).map(|(p, _)| p.clone()));
                    continue;
                }
            };
            for (pid, q) in &qid {
                let ent = &ents[q];
                if ent.is_null() {
                    continue;
                }
                for c in ent["claims"]["P18"].as_array().into_iter().flatten() {
                    if let Some(f) = c["mainsnak"]["datavalue"]["value"].as_str() {
                        cands.entry(pid.clone()).or_default().push(f.to_owned());
                    }
                }
                if let Some(links) = ent["sitelinks"].as_object() {
                    sitelinks.insert(
                        pid.clone(),
                        links
                            .iter()
                            .filter_map(|(k, v)| Some((k.strip_suffix("wiki")?.to_owned(), v["title"].as_str()?.to_owned())))
                            .collect(),
                    );
                }
            }
        }

        // 3. zdjęcia główne z innych Wikipedii
        for lang in ALT_LANGS {
            let need: Vec<(String, String)> = todo
                .iter()
                .filter_map(|p| sitelinks.get(*p).and_then(|s| s.get(*lang)).map(|t| ((*p).clone(), t.clone())))
                .collect();
            for chunk in need.chunks(50) {
                let titles: Vec<String> = chunk.iter().map(|(_, t)| t.clone()).collect();
                match self.query_pages(lang, &titles, &[("prop", "pageimages"), ("piprop", "name")]).await {
                    Ok(pages) => {
                        for (pid, title) in chunk {
                            if let Some(f) = pages.get(title).and_then(|p| p["pageimage"].as_str()) {
                                cands.entry(pid.clone()).or_default().push(f.to_owned());
                            }
                        }
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                    Err(e) => {
                        tracing::warn!("[zdjęcia alt] błąd API ({lang}): {e}");
                        failed.extend(chunk.iter().map(|(p, _)| p.clone()));
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                }
            }
        }

        // 4. pierwszy kandydat inny niż zdjęcie główne
        let mut found = 0;
        for pid in todo {
            let mut seen: HashSet<String> = [lead.get(pid).cloned().unwrap_or_default()].into();
            let mut pick = None;
            for f in cands.get(pid).into_iter().flatten() {
                let n = norm(f);
                if seen.contains(&n) || !usable(f) {
                    seen.insert(n);
                    continue;
                }
                pick = Some(f.clone());
                break;
            }
            if let Some(f) = pick {
                let url = format!(
                    "https://commons.wikimedia.org/wiki/Special:FilePath/{}?width={THUMB_SIZE}",
                    quote(&f.replace(' ', "_"))
                );
                match self.get(&url, 4).await.map_err(|e| e.to_string()).and_then(|b| self.save_wiki(pid, &b, &Kind::Alt)) {
                    Ok(()) => {
                        found += 1;
                        missing.remove(pid);
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                    Err(e) => tracing::warn!("[zdjęcia alt] {pid}: {e}"),
                }
            } else if !failed.contains(pid) {
                if force {
                    self.delete(pid, &Kind::Alt); // stare, nietrafione zdjęcie alt
                }
                missing.insert(pid.clone());
            }
        }
        let mut sorted: Vec<_> = missing.into_iter().collect();
        sorted.sort();
        let _ = std::fs::create_dir_all(&self.cache_dir);
        let _ = std::fs::write(self.alt_missing_file(), serde_json::to_string(&sorted).unwrap_or_default());
        found
    }
}

/// urllib.parse.quote (bez "/")
fn quote(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"_.-~/".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

// ---------------------------------------------------------------- przetwarzanie obrazów (WebP, kadr)

/// Kadr jako ułamki oryginału (0..1): lewy górny róg i rozmiar
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Crop {
    /// Pole formularza: pusty napis = bez kadru, inaczej JSON {"x":..,"y":..,"w":..,"h":..}
    pub fn parse(text: &str) -> Result<Option<Crop>, String> {
        let text = text.trim();
        if text.is_empty() {
            return Ok(None);
        }
        let c: Crop = serde_json::from_str(text).map_err(|_| "Nieprawidłowy kadr zdjęcia".to_owned())?;
        c.validate()?;
        Ok(Some(c))
    }

    pub fn validate(&self) -> Result<(), String> {
        let ok = [self.x, self.y, self.w, self.h].iter().all(|v| v.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.w > 0.0
            && self.h > 0.0
            && self.x + self.w <= 1.0 + 1e-6
            && self.y + self.h <= 1.0 + 1e-6;
        if ok {
            Ok(())
        } else {
            Err("Kadr wychodzi poza zdjęcie".into())
        }
    }

    /// Prostokąt w pikselach (x, y, szerokość, wysokość); błąd, gdy któryś bok < 32 px
    fn pixels(&self, width: u32, height: u32) -> Result<(u32, u32, u32, u32), String> {
        self.validate()?;
        let (fw, fh) = (width as f64, height as f64);
        let x = ((self.x * fw).round() as u32).min(width.saturating_sub(1));
        let y = ((self.y * fh).round() as u32).min(height.saturating_sub(1));
        let w = ((self.w * fw).round() as u32).min(width - x);
        let h = ((self.h * fh).round() as u32).min(height - y);
        if w < MIN_CROP_PX || h < MIN_CROP_PX {
            return Err(format!("Kadr jest za mały (min. {MIN_CROP_PX} px)"));
        }
        Ok((x, y, w, h))
    }
}

fn limits() -> image::Limits {
    let mut l = image::Limits::default();
    l.max_image_width = Some(12_000);
    l.max_image_height = Some(12_000);
    l.max_alloc = Some(384 * 1024 * 1024);
    l
}

/// Dekoduje obrazek (z limitami wymiarów i pamięci) i obraca go zgodnie z EXIF
pub fn decode(blob: &[u8]) -> Result<DynamicImage, String> {
    fn bad<E>(_: E) -> String {
        "Nie udało się odczytać obrazka".to_owned()
    }
    let mut decoder = ImageReader::new(std::io::Cursor::new(blob)).with_guessed_format().map_err(bad)?.into_decoder().map_err(bad)?;
    decoder.set_limits(limits()).map_err(|_| "Obrazek jest za duży".to_owned())?;
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut im = DynamicImage::from_decoder(decoder).map_err(bad)?;
    im.apply_orientation(orientation);
    Ok(im)
}

fn is_animated_gif(blob: &[u8]) -> bool {
    image::codecs::gif::GifDecoder::new(std::io::Cursor::new(blob)).map(|d| d.into_frames().take(2).count() > 1).unwrap_or(false)
}

/// Najwięcej klatek kadrowanego GIF-a (dłuższe animacje są odrzucane - każda klatka jest w pamięci jako RGBA)
const GIF_MAX_FRAMES: usize = 600;

/// Animowany GIF -> ten sam kadr wycięty z każdej klatki -> animowany GIF (czasy klatek i zapętlenie zostają)
fn crop_gif(blob: &[u8], crop: Crop) -> Result<Vec<u8>, String> {
    use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
    use image::{AnimationDecoder, Frame};
    let bad = |_| "Nie udało się odczytać animowanego GIF-a".to_owned();
    let mut decoder = GifDecoder::new(std::io::Cursor::new(blob)).map_err(bad)?;
    decoder.set_limits(limits()).map_err(|_| "Obrazek jest za duży".to_owned())?;
    let (width, height) = image::ImageDecoder::dimensions(&decoder);
    let (x, y, w, h) = crop.pixels(width, height)?;
    let mut out = Vec::new();
    {
        let mut encoder = GifEncoder::new_with_speed(&mut out, 10);
        encoder.set_repeat(Repeat::Infinite).map_err(|e| e.to_string())?;
        for (i, frame) in decoder.into_frames().enumerate() {
            if i >= GIF_MAX_FRAMES {
                return Err(format!("GIF ma za dużo klatek do kadrowania (max {GIF_MAX_FRAMES})"));
            }
            let frame = frame.map_err(bad)?;
            let delay = frame.delay();
            let cut = image::imageops::crop_imm(frame.buffer(), x, y, w, h).to_image();
            encoder.encode_frame(Frame::from_parts(cut, 0, 0, delay)).map_err(|e| format!("Nie udało się zapisać GIF-a: {e}"))?;
        }
    }
    if out.len() > MAX_UPLOAD {
        return Err("Wykadrowany GIF jest za duży (max 8 MB) - wybierz mniejszy kadr".into());
    }
    Ok(out)
}

/// Kadr -> zmniejszenie do MAX_SIDE -> WebP
fn process(blob: &[u8], crop: Option<Crop>) -> Result<Vec<u8>, String> {
    let mut im = decode(blob)?;
    if let Some(c) = crop {
        let (x, y, w, h) = c.pixels(im.width(), im.height())?;
        im = im.crop_imm(x, y, w, h);
    }
    if im.width().max(im.height()) > MAX_SIDE {
        im = im.resize(MAX_SIDE, MAX_SIDE, image::imageops::FilterType::Lanczos3);
    }
    let alpha = im.color().has_alpha();
    let im = if alpha { DynamicImage::ImageRgba8(im.to_rgba8()) } else { DynamicImage::ImageRgb8(im.to_rgb8()) };
    let encoder = webp::Encoder::from_image(&im).map_err(|e| format!("Nie udało się zapisać obrazka: {e}"))?;
    Ok(encoder.encode(if alpha { QUALITY_ALPHA } else { QUALITY }).to_vec())
}

/// Jedyna droga zapisu zdjęcia rastrowego: dowolny obrazek -> WebP (q 85, z alfą q 92), dłuższy bok najwyżej 1600 px
pub fn to_webp(blob: &[u8]) -> Result<Vec<u8>, String> {
    process(blob, None)
}

/// Przy starcie: stare .jpg/.png/.gif/.bmp w image_cache -> .webp obok (oryginał znika po udanym zapisie).
/// Zwraca (zamienione, pominięte, błędy).
pub fn migrate_to_webp(cache_dir: &Path) -> (usize, usize, usize) {
    let _ = std::fs::remove_dir_all(cache_dir.join("_web"));
    let Ok(dir) = std::fs::read_dir(cache_dir) else { return (0, 0, 0) };
    let (mut done, mut skipped, mut failed) = (0, 0, 0);
    for entry in dir.flatten() {
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|e| e.to_str()).map(str::to_lowercase) else { continue };
        if !path.is_file() || !LEGACY_EXTS.contains(&ext.as_str()) {
            continue;
        }
        let target = path.with_extension("webp");
        let result = (|| -> Result<bool, String> {
            if target.metadata().is_ok_and(|m| m.len() > 0) {
                std::fs::remove_file(&path).map_err(|e| e.to_string())?; // WebP już jest (i wygrywa przy odczycie)
                return Ok(true);
            }
            let blob = std::fs::read(&path).map_err(|e| e.to_string())?;
            if ext == "gif" && is_animated_gif(&blob) {
                return Ok(false);
            }
            let data = to_webp(&blob)?;
            let tmp = path.with_extension("webp.tmp");
            std::fs::write(&tmp, &data).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
            // dawniej zdjęcia z Wikipedii były zawsze .jpg, a wgrane w panelu nie - zachowaj tę wiedzę dla eksportu
            if ext == "jpg" {
                let _ = std::fs::write(path.with_extension("webp.wiki"), b"");
            }
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
            Ok(true)
        })();
        match result {
            Ok(true) => done += 1,
            Ok(false) => skipped += 1,
            Err(e) => {
                failed += 1;
                tracing::warn!("[zdjęcia] migracja {}: {e}", path.display());
            }
        }
    }
    (done, skipped, failed)
}

// ---------------------------------------------------------------- pobieranie z linku (ochrona SSRF)

/// Czy z serwera wolno łączyć się z tym adresem (tylko publiczny internet)
pub fn ip_allowed(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => ipv4_allowed(v4),
        IpAddr::V6(v6) => {
            // ::ffff:a.b.c.d i ::a.b.c.d (w tym ::1 jako 0.0.0.1) wg reguł IPv4
            if let Some(v4) = v6.to_ipv4_mapped().or_else(|| v6.to_ipv4()) {
                return ipv4_allowed(v4);
            }
            let seg = v6.segments();
            if seg[0] == 0x0064 && seg[1] == 0xff9b && seg[2..6] == [0, 0, 0, 0] {
                let o = v6.octets(); // NAT64 64:ff9b::/96
                return ipv4_allowed(Ipv4Addr::new(o[12], o[13], o[14], o[15]));
            }
            !(v6.is_unspecified()
                || v6.is_loopback()
                || v6.is_multicast()
                || (seg[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (seg[0] & 0xffc0) == 0xfe80 // link-local
                || (seg[0] & 0xffc0) == 0xfec0 // site-local
                || (seg[0] == 0x2001 && seg[1] == 0x0db8)) // dokumentacja
        }
    }
}

fn ipv4_allowed(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_documentation()
        || o[0] == 0
        || o[0] >= 240
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // CGNAT 100.64.0.0/10
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24
        || (o[0] == 198 && (o[1] & 0xfe) == 18)) // 198.18.0.0/15
}

/// Pobiera obrazek spod linku: tylko http/https, port 80/443/8080, wyłącznie publiczne adresy (DNS rozwiązany i sprawdzony,
/// połączenie idzie do sprawdzonego IP), do 3 przekierowań (każdy cel sprawdzany od nowa), 15 s, max 10 MB.
async fn fetch_remote(url: &str) -> Result<Vec<u8>, String> {
    let mut current = reqwest::Url::parse(url).map_err(|_| "Nieprawidłowy adres obrazka".to_owned())?;
    for hop in 0..=3 {
        let client = remote_client(&current).await?;
        let mut resp = client.get(current.clone()).send().await.map_err(|e| {
            if e.is_timeout() {
                "Serwer zdjęcia nie odpowiedział w 15 sekund".to_owned()
            } else {
                "Nie udało się połączyć z adresem zdjęcia".to_owned()
            }
        })?;
        if resp.status().is_redirection() {
            if hop == 3 {
                return Err("Za dużo przekierowań".into());
            }
            let loc = resp.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).ok_or("Przekierowanie bez celu")?;
            current = current.join(loc).map_err(|_| "Nieprawidłowe przekierowanie".to_owned())?;
            continue;
        }
        if !resp.status().is_success() {
            return Err(format!("Adres zdjęcia zwrócił błąd {}", resp.status().as_u16()));
        }
        if resp.content_length().is_some_and(|n| n > MAX_REMOTE as u64) {
            return Err("Zdjęcie z linku jest za duże (max 10 MB)".into());
        }
        let mut body = Vec::new();
        let read = async {
            while let Some(chunk) = resp.chunk().await.map_err(|_| "Przerwano pobieranie zdjęcia".to_owned())? {
                if body.len() + chunk.len() > MAX_REMOTE {
                    return Err("Zdjęcie z linku jest za duże (max 10 MB)".to_owned());
                }
                body.extend_from_slice(&chunk);
            }
            Ok::<(), String>(())
        };
        tokio::time::timeout(Duration::from_secs(15), read).await.map_err(|_| "Pobieranie zdjęcia trwało za długo".to_owned())??;
        return Ok(body);
    }
    Err("Za dużo przekierowań".into())
}

/// Klient HTTP związany ze sprawdzonym adresem IP celu
async fn remote_client(url: &reqwest::Url) -> Result<reqwest::Client, String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Adres musi zaczynać się od http:// lub https://".into());
    }
    let port = url.port_or_known_default().unwrap_or(0);
    if !matches!(port, 80 | 443 | 8080) {
        return Err("Niedozwolony port w adresie zdjęcia (dozwolone 80, 443, 8080)".into());
    }
    let host = url.host_str().ok_or("Nieprawidłowy adres obrazka")?;
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    let mut builder =
        reqwest::Client::builder().user_agent(USER_AGENT).redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(15));
    if let Ok(ip) = bare.parse::<IpAddr>() {
        if !ip_allowed(ip) {
            return Err("Ten adres jest niedozwolony".into());
        }
    } else {
        let addrs: Vec<IpAddr> = tokio::net::lookup_host((bare, port))
            .await
            .map_err(|_| "Nie znaleziono serwera spod tego adresu".to_owned())?
            .map(|a| a.ip())
            .collect();
        if addrs.is_empty() || addrs.iter().any(|ip| !ip_allowed(*ip)) {
            return Err("Ten adres jest niedozwolony".into());
        }
        builder = builder.resolve(bare, std::net::SocketAddr::new(addrs[0], port));
    }
    builder.build().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffing_and_names() {
        assert_eq!(sniff(b"\xff\xd8\xff\xe0..."), Some("jpg"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff(b"<html>"), None);
        assert!(usable("File:Lech_Walesa_2009.jpg"));
        assert!(!usable("Signature of X.png"));
        assert_eq!(quote("Ąb c/d.jpg"), "%C4%84b%20c/d.jpg");
    }

    fn png(w: u32, h: u32, alpha: bool) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        let im = if alpha {
            DynamicImage::ImageRgba8(image::RgbaImage::from_fn(w, h, |x, _| image::Rgba([200, 30, 30, if x < w / 2 { 0 } else { 255 }])))
        } else {
            DynamicImage::ImageRgb8(image::RgbImage::from_fn(w, h, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 90])))
        };
        im.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn cropped_animated_gif_stays_animated() {
        use image::codecs::gif::{GifDecoder, GifEncoder};
        use image::{AnimationDecoder, Delay, Frame, Rgba, RgbaImage};
        let mut gif = Vec::new();
        {
            let mut enc = GifEncoder::new(&mut gif);
            for color in [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]] {
                let im = RgbaImage::from_pixel(200, 100, Rgba(color));
                enc.encode_frame(Frame::from_parts(im, 0, 0, Delay::from_numer_denom_ms(100, 1))).unwrap();
            }
        }
        assert!(super::is_animated_gif(&gif));
        let out = super::crop_gif(&gif, super::Crop { x: 0.25, y: 0.0, w: 0.5, h: 1.0 }).unwrap();
        let frames = GifDecoder::new(std::io::Cursor::new(&out)).unwrap().into_frames().collect_frames().unwrap();
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0].buffer().dimensions(), (100, 100));
        assert_eq!(frames[1].buffer().get_pixel(50, 50).0[2], 255, "druga klatka niebieska");
    }

    #[test]
    fn to_webp_keeps_alpha_and_shrinks() {
        let out = to_webp(&png(200, 100, true)).unwrap();
        assert_eq!(sniff(&out), Some("webp"));
        let im = decode(&out).unwrap();
        assert!(im.color().has_alpha());
        let rgba = im.to_rgba8();
        assert!(rgba.get_pixel(5, 50)[3] < 20);
        assert!(rgba.get_pixel(190, 50)[3] > 235);
        let big = to_webp(&png(3200, 1000, false)).unwrap();
        let im = decode(&big).unwrap();
        assert_eq!((im.width(), im.height()), (1600, 500));
        let small = decode(&to_webp(&png(300, 200, false)).unwrap()).unwrap();
        assert_eq!((small.width(), small.height()), (300, 200));
        assert!(to_webp(b"not an image").is_err());
    }

    #[test]
    fn crop_validation_and_cut() {
        assert_eq!(Crop::parse("").unwrap(), None);
        for bad in [
            r#"{"x":-0.1,"y":0,"w":0.5,"h":0.5}"#,
            r#"{"x":0.6,"y":0,"w":0.5,"h":0.5}"#,
            r#"{"x":0,"y":0,"w":0,"h":0.5}"#,
            r#"{"x":0,"y":0.5,"w":0.5,"h":1.2}"#,
            r#"{"x":0,"y":0}"#,
            "zle",
        ] {
            assert!(Crop::parse(bad).is_err(), "{bad}");
        }
        let c = Crop::parse(r#"{"x":0.25,"y":0.5,"w":0.5,"h":0.5}"#).unwrap().unwrap();
        let out = process(&png(400, 200, false), Some(c)).unwrap();
        let im = decode(&out).unwrap();
        assert_eq!((im.width(), im.height()), (200, 100));
        let tiny = Crop { x: 0.0, y: 0.0, w: 0.05, h: 0.5 };
        assert!(process(&png(400, 200, false), Some(tiny)).unwrap_err().contains("za mały"));
    }

    #[test]
    fn ip_filter() {
        let ok = |s: &str| ip_allowed(s.parse().unwrap());
        for bad in [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "100.64.0.1",
            "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
            "::ffff:169.254.169.254", "64:ff9b::7f00:1", "2001:db8::1",
        ] {
            assert!(!ok(bad), "{bad} powinien być odrzucony");
        }
        for good in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"] {
            assert!(ok(good), "{good} powinien przejść");
        }
    }
}
