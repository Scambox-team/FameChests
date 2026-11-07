//! Import i eksport kart w panelu admina: JSON (pełne karty, także Arena i teksty) albo CSV (płaska tabela do arkusza).
//! Wiersze z pliku przechodzą to samo sprawdzanie co formularz karty (`admin_save_card`); najpierw podgląd
//! (`dryRun`), dopiero potem zapis. Zdjęcia: pole `imageUrl` albo artykuł Wikipedii (`wikiTitle`).

use std::collections::{BTreeSet, HashMap, HashSet};

use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::admin::{slug, unique_id};
use super::{ok, JsonBody};
use crate::auth::Admin;
use crate::catalog::{self, Catalog, Person, RawAbility, RawArenaCfg, Table};
use crate::data::g;
use crate::error::{bad, Res};
use crate::game::log_admin;
use crate::images::Kind;
use crate::state::AppState;
use crate::text::{clean, Truncate};

/// Najwięcej kart w jednym pliku (zdjęcia z Wikipedii pobierają się po kolei)
const MAX_ROWS: usize = 500;
/// Kolumny pliku CSV (po nich w eksporcie idą kolumny zdolności `ability<n>name/kind/value`)
const CSV_COLUMNS: &[&str] = &[
    "id", "name", "rarity", "type", "crates", "exclusive", "hp", "attack", "dmg", "attack2", "dmg2", "kind1", "kind2", "wikiLang",
    "wikiTitle", "country", "subtitle", "desc", "imageUrl",
];

// ---------------------------------------------------------------- CSV

/// Tabela z tekstu CSV: separator `,` `;` albo tabulator (rozpoznany po nagłówku), cudzysłowy, BOM i znaki nowej linii w polach
pub fn csv_parse(text: &str) -> Vec<Vec<String>> {
    let text = text.trim_start_matches('\u{feff}');
    let head = text.lines().next().unwrap_or("");
    let count = |c: char| head.matches(c).count();
    let delim = if count('\t') > count(';') && count('\t') > count(',') {
        '\t'
    } else if count(';') > count(',') {
        ';'
    } else {
        ','
    };
    let (mut rows, mut row, mut field) = (vec![], vec![], String::new());
    let (mut quoted, mut was_quoted) = (false, false);
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted => {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            }
            '"' if field.is_empty() && !was_quoted => {
                quoted = true;
                was_quoted = true;
            }
            c if c == delim && !quoted => {
                row.push(std::mem::take(&mut field));
                was_quoted = false;
            }
            '\r' if !quoted => {}
            '\n' if !quoted => {
                row.push(std::mem::take(&mut field));
                was_quoted = false;
                rows.push(std::mem::take(&mut row));
            }
            c => field.push(c),
        }
    }
    if !field.is_empty() || was_quoted || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows.retain(|r| r.iter().any(|f| !f.trim().is_empty()));
    rows
}

pub fn csv_write(rows: &[Vec<String>]) -> String {
    let cell = |f: &str| {
        if f.contains([',', '"', '\n', '\r', ';']) {
            format!("\"{}\"", f.replace('"', "\"\""))
        } else {
            f.to_owned()
        }
    };
    let mut out = String::from('\u{feff}'); // BOM: Excel poprawnie czyta polskie litery
    for r in rows {
        out.push_str(&r.iter().map(|f| cell(f)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    }
    out
}

// ---------------------------------------------------------------- odczyt pól (JSON i CSV po konwersji na Value)

/// Nazwa kolumny / klucza bez wielkości liter, spacji, `_` i `-`: "wiki_title" = "wikiTitle"
fn norm(s: &str) -> String {
    s.chars().filter(|c| !matches!(c, '_' | '-' | ' ')).flat_map(char::to_lowercase).collect()
}

fn field<'a>(v: &'a Value, names: &[&str]) -> Option<&'a Value> {
    let obj = v.as_object()?;
    names.iter().find_map(|n| {
        let n = norm(n);
        obj.iter().find(|(k, val)| norm(k) == n && !val.is_null()).map(|(_, val)| val)
    })
}

/// Tekst z pola (liczba też się liczy); None = pola nie ma. Puste pole = Some("")
fn text(v: &Value, names: &[&str]) -> Option<String> {
    match field(v, names)? {
        Value::String(s) => Some(s.trim().to_owned()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn int(v: &Value, names: &[&str]) -> Result<Option<i64>, String> {
    let Some(val) = field(v, names) else { return Ok(None) };
    let t = match val {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.trim().to_owned(),
        _ => return Err(format!("{}: to nie liczba", names[0])),
    };
    if t.is_empty() {
        return Ok(None);
    }
    t.parse::<i64>()
        .or_else(|_| t.replace(',', ".").parse::<f64>().map(|f| f.round() as i64))
        .map(Some)
        .map_err(|_| format!("{}: „{t}” to nie liczba", names[0]))
}

/// Lista z tablicy JSON albo z tekstu rozdzielonego `;` `|` (przecinek też, gdy nic innego nie ma)
fn list(v: &Value, names: &[&str]) -> Option<Vec<String>> {
    match field(v, names)? {
        Value::Array(a) => Some(a.iter().filter_map(|x| x.as_str().map(|s| s.trim().to_owned())).filter(|s| !s.is_empty()).collect()),
        Value::String(s) => {
            let sep: &[char] = if s.contains([';', '|']) { &[';', '|'] } else { &[','] };
            Some(s.split(sep).map(|x| x.trim().to_owned()).filter(|x| !x.is_empty()).collect())
        }
        _ => None,
    }
}

fn flag(v: &Value, names: &[&str]) -> Option<bool> {
    match field(v, names)? {
        Value::Bool(b) => Some(*b),
        Value::String(s) => Some(matches!(s.trim().to_lowercase().as_str(), "1" | "true" | "tak" | "yes" | "x")),
        Value::Number(n) => Some(n.as_i64().unwrap_or(0) != 0),
        _ => None,
    }
}

/// Artykuł Wikipedii: `wiki: ["pl", "Tytuł"]`, `wiki: {lang, title}` albo `wikiLang` + `wikiTitle`
fn wiki(v: &Value) -> Option<Option<(String, String)>> {
    let pair = match field(v, &["wiki"]) {
        Some(Value::Array(a)) => Some((a.first()?.as_str()?.to_owned(), a.get(1)?.as_str()?.to_owned())),
        Some(o @ Value::Object(_)) => Some((text(o, &["lang"]).unwrap_or_default(), text(o, &["title"])?)),
        _ => text(v, &["wikiTitle"]).map(|t| (text(v, &["wikiLang"]).unwrap_or_default(), t)),
    }?;
    let (lang, title) = pair;
    if title.is_empty() {
        return Some(None); // puste pole = bez artykułu
    }
    let lang = clean(if lang.is_empty() { "pl" } else { &lang }, 5);
    Some(Some((lang, title)))
}

/// Nazwa -> klucz: porównuje z kluczem i z podanymi nazwami, bez wielkości liter
fn resolve<'a>(input: &str, items: impl IntoIterator<Item = (&'a str, Vec<&'a str>)>) -> Option<String> {
    let want = norm(input);
    items.into_iter().find(|(k, names)| norm(k) == want || names.iter().any(|n| norm(n) == want)).map(|(k, _)| k.to_owned())
}

fn resolve_crate(cat: &Catalog, input: &str) -> Result<String, String> {
    resolve(input, cat.crates.values().filter(|c| !c.special).map(|c| (c.id.as_str(), vec![c.name.as_str(), c.short.as_str(), c.code.as_str()])))
        .ok_or_else(|| format!("Nieznana skrzynka „{input}”"))
}

// ---------------------------------------------------------------- jeden wiersz -> pola karty

struct Prepared {
    pid: String,
    name: String,
    is_new: bool,
    fields: Map<String, Value>,
    wiki: Option<(String, String)>,
    wiki_changed: bool,
    image_url: Option<String>,
}

enum Outcome {
    Skip(String),
    Save(Box<Prepared>),
}

struct Opts {
    default_crate: Option<String>,
    update_existing: bool,
    skip_existing: bool,
}

/// Karty zapisane w tym samym pliku wcześniej (id i efekty unikalne w Arenie)
#[derive(Default)]
struct Batch {
    taken: HashSet<String>,
    unique_effects: HashMap<String, String>,
}

fn prepare(v: &Value, cat: &Catalog, opts: &Opts, batch: &mut Batch) -> Result<Outcome, String> {
    let g = g();
    if !v.is_object() {
        return Err("Wiersz nie jest obiektem".into());
    }
    let name = text(v, &["name", "nazwa"]).unwrap_or_default();
    let given = text(v, &["id"]).filter(|s| !s.is_empty());
    if let Some(id) = &given {
        if id.len() > 60 || !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
            return Err(format!("Nieprawidłowe id „{id}” (małe litery bez polskich znaków, cyfry i _)"));
        }
    }
    let exists = |pid: &str| cat.person(pid).is_some() || cat.hidden_cards.contains_key(pid);
    let existing = given.clone().filter(|p| exists(p));
    let old = existing.as_deref().and_then(|p| cat.person(p));
    let is_new = existing.is_none();
    if !is_new && !opts.update_existing {
        return Ok(Outcome::Skip(format!("karta {} już istnieje", existing.unwrap_or_default())));
    }
    if is_new && name.is_empty() {
        return Err("Brak nazwy karty".into());
    }

    let rarity = match text(v, &["rarity", "rzadkosc"]) {
        Some(r) if !r.is_empty() => Some(
            resolve(&r, g.rarities.iter().map(|(k, d)| (k.as_str(), vec![d.name.as_str()])))
                .ok_or_else(|| format!("Nieznana rzadkość „{r}”"))?,
        ),
        _ => None,
    };
    let type_ = match text(v, &["type", "typ"]) {
        Some(t) if !t.is_empty() => Some(
            resolve(&t, g.types.keys().map(|k| (k.as_str(), vec![g.types_json[k]["name"].as_str().unwrap_or("")])))
                .ok_or_else(|| format!("Nieznany typ „{t}”"))?,
        ),
        _ => None,
    };
    if is_new && (rarity.is_none() || type_.is_none()) {
        return Err("Brak rzadkości lub typu".into());
    }
    let eff_rarity = rarity.clone().or_else(|| old.map(|p| p.rarity.clone())).unwrap_or_default();

    // skrzynki: karta specjalna jest tylko w skrzynce kart specjalnych, zwykła - nigdy
    let mut crates: Option<Vec<String>> = match list(v, &["crates", "crate", "skrzynki", "skrzynka"]) {
        Some(l) if !l.is_empty() => Some(l.iter().map(|c| resolve_crate(cat, c)).collect::<Result<_, _>>()?),
        _ => None,
    };
    if crates.is_none() && is_new && eff_rarity != "special" {
        crates = Some(vec![resolve_crate(cat, opts.default_crate.as_deref().ok_or("Brak skrzynki (kolumna crates)")?)?]);
    }
    if eff_rarity == "special" && cat.crates.contains_key(&g.special_crate) && (is_new || crates.is_some() || rarity.is_some()) {
        crates = Some(vec![g.special_crate.clone()]);
    }
    if let Some(c) = &mut crates {
        let mut seen = HashSet::new();
        c.retain(|x| seen.insert(x.clone()));
    }

    // powtórka z poprzedniego importu: ta sama nazwa w tej samej skrzynce
    if is_new && opts.skip_existing {
        let main = crates.as_ref().and_then(|c| c.first());
        let dup = cat.people.values().find(|p| p.name.to_lowercase() == name.to_lowercase() && main.is_none_or(|m| p.crates.contains(m)));
        if let Some(p) = dup {
            return Ok(Outcome::Skip(format!("karta „{}” już jest ({})", p.name, p.id)));
        }
    }

    let mut f = Map::new();
    if !name.is_empty() {
        f.insert("name".into(), json!(name.truncate_chars(60)));
    }
    if let Some(r) = &rarity {
        f.insert("rarity".into(), json!(r));
    }
    if let Some(t) = &type_ {
        f.insert("type".into(), json!(t));
    }
    if let Some(c) = &crates {
        f.insert("crate".into(), json!(c[0]));
        f.insert("crates".into(), json!(c));
    }
    if let Some(ex) = list(v, &["exclusive", "ekskluzywna"]) {
        let ex: Vec<String> = ex.iter().map(|c| resolve_crate(cat, c)).collect::<Result<_, _>>()?;
        let ok_in = |c: &String| crates.as_ref().is_none_or(|all| all.contains(c));
        f.insert("exclusive".into(), json!(ex.into_iter().filter(ok_in).collect::<Vec<_>>()));
    } else if is_new {
        f.insert("exclusive".into(), json!(Vec::<String>::new()));
    }
    for (key, names, default, max) in [("hp", &["hp"][..], 50, 9999), ("dmg", &["dmg", "obrazenia"], 30, 9999), ("dmg2", &["dmg2"], 0, 9999)] {
        match int(v, names)? {
            Some(n) => f.insert(key.into(), json!(n.clamp(0, max))),
            None if is_new => f.insert(key.into(), json!(default)),
            None => None,
        };
    }
    match text(v, &["attack", "atak"]) {
        Some(a) if !a.is_empty() => f.insert("attack".into(), json!(clean(&a, 40))),
        _ if is_new => f.insert("attack".into(), json!("Atak")),
        _ => None,
    };
    match text(v, &["attack2"]) {
        Some(a) => f.insert("attack2".into(), if a.is_empty() { Value::Null } else { json!(clean(&a, 40)) }),
        None if is_new => f.insert("attack2".into(), Value::Null),
        None => None,
    };
    for key in ["kind1", "kind2"] {
        match text(v, &[key]) {
            Some(k) if !k.is_empty() => {
                let k = k.to_lowercase();
                if g.ability_kinds.get(&k).is_none() {
                    return Err(format!("{key}: nieznany rodzaj zdolności „{k}”"));
                }
                f.insert(key.into(), json!(k));
            }
            _ if is_new => {
                f.insert(key.into(), json!("off"));
            }
            _ => {}
        }
    }
    // zdolności: tablica `abilities` albo kolumny ability<n>name / ability<n>kind / ability<n>value
    let abilities: Option<Vec<RawAbility>> = if let Some(Value::Array(a)) = field(v, &["abilities", "zdolnosci"]) {
        Some(a.iter().filter_map(|x| serde_json::from_value::<RawAbility>(x.clone()).ok()).collect())
    } else {
        let cols: Vec<RawAbility> = (1..=8)
            .filter_map(|n| {
                let name = text(v, &[&format!("ability{n}name")])?;
                let kind = text(v, &[&format!("ability{n}kind")]).unwrap_or_default().to_lowercase();
                let value = int(v, &[&format!("ability{n}value")]).ok().flatten().unwrap_or(0);
                Some(RawAbility { name, kind: Some(kind), value })
            })
            .collect();
        (!cols.is_empty()).then_some(cols)
    };
    if let Some(a) = abilities {
        f.insert("abilities".into(), json!(catalog::clean_abilities(&a)));
    } else if is_new {
        f.insert("abilities".into(), json!(Vec::<Value>::new()));
    }

    let wiki_new = wiki(v);
    if let Some(w) = &wiki_new {
        f.insert("wiki".into(), json!(w));
    }
    if let Some(c) = text(v, &["country", "kraj"]) {
        f.insert("country".into(), json!(catalog::clean_country(&c)));
    }
    if let Some(s) = text(v, &["subtitle", "podtytul"]) {
        f.insert("subtitle".into(), json!(clean(&s, catalog::SUBTITLE_MAX)));
    }
    if let Some(d) = text(v, &["desc", "opis"]) {
        f.insert("desc".into(), json!(clean(&d.replace("\r\n", "\n"), catalog::DESC_MAX)));
    }
    // tylko JSON: Arena, napisy na karcie, karty specjalne, easter egg
    let pid = existing.clone().unwrap_or_else(|| {
        let main = crates.as_ref().and_then(|c| c.first().cloned()).unwrap_or_else(|| g.special_crate.clone());
        let id = given.clone().unwrap_or_else(|| {
            let prefix = if main == "world" { "w" } else { main.as_str() };
            unique_id(&format!("{prefix}_{}", slug(&name)), cat.people.keys().chain(cat.hidden_cards.keys()).chain(batch.taken.iter()))
        });
        id
    });
    if is_new && !batch.taken.insert(pid.clone()) {
        return Err(format!("id „{pid}” występuje w pliku więcej niż raz"));
    }
    if let Some(a) = field(v, &["arena"]) {
        let raw: Vec<RawArenaCfg> = serde_json::from_value(a.clone()).map_err(|_| "Nieprawidłowe ustawienia Areny")?;
        let arena = catalog::clean_arena(&raw);
        for e in arena.iter().flat_map(|c| &c.effects) {
            let Some(info) = g.arena_effects.get(&e.id).filter(|i| i.unique) else { continue };
            let other = cat
                .people
                .values()
                .find(|p| p.id != pid && p.arena.iter().flat_map(|c| &c.effects).any(|x| x.id == e.id))
                .map(|p| p.name.clone())
                .or_else(|| batch.unique_effects.get(&e.id).filter(|p| **p != pid).cloned());
            if let Some(other) = other {
                return Err(format!("Efekt „{}” jest unikalny - ma go już karta {other}", info.name));
            }
            batch.unique_effects.insert(e.id.clone(), pid.clone());
        }
        f.insert("arena".into(), json!(arena));
    }
    if let Some(t) = field(v, &["texts"]) {
        f.insert("texts".into(), json!(catalog::clean_texts(t)));
    }
    if let Some(t) = field(v, &["vx"]) {
        f.insert("vx".into(), Value::Object(catalog::clean_vx(t)));
    }
    if let Some(s) = text(v, &["source"]) {
        f.insert("source".into(), if s.is_empty() { Value::Null } else { json!(s) });
    }
    if let Some(s) = text(v, &["fixedVariant"]) {
        f.insert("fixedVariant".into(), if s.is_empty() { Value::Null } else { json!(s) });
    }
    if let Some(s) = int(v, &["style"])? {
        f.insert("style".into(), json!(s));
    }
    if let Some(b) = flag(v, &["bibi"]) {
        f.insert("bibi".into(), json!(b));
    }
    // skrzynki istniejące w chwili zapisu - nowe wbudowane skrzynki dodane później dopiszą tę kartę
    let seen: BTreeSet<&String> = cat.crates.keys().chain(cat.hidden_crates.keys()).collect();
    f.insert("crates_seen".into(), json!(seen));

    let wiki_final = match &wiki_new {
        Some(w) => w.clone(),
        None => old.and_then(|p| p.wiki.clone()),
    };
    let wiki_changed = wiki_new.as_ref().is_some_and(|w| old.is_none_or(|p| p.wiki != *w));
    let shown = if name.is_empty() { old.map(|p| p.name.clone()).unwrap_or_default() } else { name };
    Ok(Outcome::Save(Box::new(Prepared {
        pid,
        name: shown,
        is_new,
        fields: f,
        wiki: wiki_final,
        wiki_changed,
        image_url: text(v, &["imageUrl", "image", "zdjecie"]).filter(|u| !u.is_empty()),
    })))
}

// ---------------------------------------------------------------- tekst pliku -> lista wierszy

fn rows_from_text(format: &str, body: &str) -> Result<Vec<Value>, String> {
    if body.trim().is_empty() {
        return Err("Plik jest pusty".into());
    }
    if format == "csv" {
        let mut table = csv_parse(body).into_iter();
        let header = table.next().ok_or("Plik CSV nie ma nagłówka")?;
        if !header.iter().any(|h| matches!(norm(h).as_str(), "name" | "nazwa")) {
            return Err("W pierwszym wierszu CSV musi być nagłówek z kolumną „name”".into());
        }
        return Ok(table
            .map(|r| Value::Object(header.iter().zip(r).map(|(h, c)| (h.trim().to_owned(), Value::String(c))).collect()))
            .collect());
    }
    let json: Value = serde_json::from_str(body.trim_start_matches('\u{feff}')).map_err(|e| format!("Nieprawidłowy JSON: {e}"))?;
    match json {
        Value::Array(a) => Ok(a),
        Value::Object(mut o) => match o.remove("cards") {
            Some(Value::Array(a)) => Ok(a),
            _ => Err("W pliku JSON brakuje listy „cards”".into()),
        },
        _ => Err("Plik JSON musi być listą kart albo obiektem z listą „cards”".into()),
    }
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ImportBody {
    /// "json" albo "csv"
    format: String,
    text: String,
    /// tylko sprawdź i pokaż, co by się stało
    dry_run: bool,
    /// skrzynka dla kart bez kolumny `crates`
    default_crate: Option<String>,
    update_existing: Option<bool>,
    skip_existing: Option<bool>,
    /// zapisz poprawne wiersze, nawet gdy inne mają błędy
    partial: bool,
    fetch_images: Option<bool>,
}

pub async fn admin_import_cards(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<ImportBody>) -> Res {
    let rows = match rows_from_text(&req.format, &req.text) {
        Ok(r) if r.len() > MAX_ROWS => return bad(format!("Za dużo kart naraz ({}, najwyżej {MAX_ROWS})", r.len())),
        Ok(r) if r.is_empty() => return bad("W pliku nie ma żadnej karty"),
        Ok(r) => r,
        Err(e) => return bad(e),
    };
    let cat = st.cat();
    let opts = Opts {
        default_crate: req.default_crate.filter(|c| !c.is_empty()),
        update_existing: req.update_existing.unwrap_or(true),
        skip_existing: req.skip_existing.unwrap_or(true),
    };
    let mut batch = Batch::default();
    let (mut report, mut todo) = (vec![], vec![]);
    for (i, row) in rows.iter().enumerate() {
        let label = text(row, &["name", "nazwa"]).unwrap_or_default();
        match prepare(row, &cat, &opts, &mut batch) {
            Ok(Outcome::Save(p)) => {
                report.push(json!({"row": i + 1, "name": p.name, "id": p.pid, "action": if p.is_new { "create" } else { "update" }}));
                todo.push(p);
            }
            Ok(Outcome::Skip(why)) => report.push(json!({"row": i + 1, "name": label, "action": "skip", "message": why})),
            Err(e) => report.push(json!({"row": i + 1, "name": label, "action": "error", "message": e})),
        }
    }
    let count = |a: &str| report.iter().filter(|r| r["action"] == a).count();
    let (created, updated, skipped, failed) = (count("create"), count("update"), count("skip"), count("error"));
    let apply = !req.dry_run && (failed == 0 || req.partial) && !todo.is_empty();
    let mut summary = json!({
        "dryRun": req.dry_run, "applied": apply, "created": created, "updated": updated, "skipped": skipped, "failed": failed,
        "rows": report, "warnings": Vec::<String>::new(),
    });
    if !apply {
        return ok(summary);
    }

    let mut tx = st.db.begin().await?;
    for p in &todo {
        catalog::save_override(&mut tx, Table::Cards, &p.pid, p.fields.clone()).await?;
    }
    log_admin(&mut tx, &me, "cards_import", None, &format!("{created} nowych, {updated} zmienionych ({})", req.format)).await?;
    tx.commit().await?;
    st.refresh_catalog().await?;

    // zdjęcia: adres z pliku > artykuł Wikipedii (nowa karta, zmieniony artykuł albo brak zdjęcia)
    let mut warnings: Vec<String> = vec![];
    let mut wiki_todo: Vec<(String, Option<(String, String)>)> = vec![];
    for p in &todo {
        if let Some(url) = &p.image_url {
            if let Err(e) = st.images.save_url(&p.pid, url, &Kind::Main).await {
                warnings.push(format!("{}: zdjęcie z adresu - {e}", p.name));
            }
        } else if req.fetch_images.unwrap_or(true) && p.wiki.is_some() && (p.is_new || p.wiki_changed || st.images.find(&p.pid, &Kind::Main).is_none()) {
            wiki_todo.push((p.pid.clone(), p.wiki.clone()));
        }
    }
    if !wiki_todo.is_empty() {
        let got = st.images.fetch(&wiki_todo, true).await;
        for (pid, _) in &wiki_todo {
            if !got.get(pid).copied().unwrap_or(false) {
                let name = todo.iter().find(|p| &p.pid == pid).map(|p| p.name.as_str()).unwrap_or(pid);
                warnings.push(format!("{name}: nie znaleziono zdjęcia w artykule Wikipedii"));
            }
        }
    }
    summary["warnings"] = json!(warnings);
    ok(summary)
}

// ---------------------------------------------------------------- eksport

/// Karta w formacie pliku (te same klucze przyjmuje import). `full` = także Arena, napisy i karty specjalne.
fn card_value(p: &Person, full: bool) -> Value {
    let (lang, title) = p.wiki.clone().unwrap_or_default();
    let mut o = Map::new();
    o.insert("id".into(), json!(p.id));
    o.insert("name".into(), json!(p.name));
    o.insert("rarity".into(), json!(p.rarity));
    o.insert("type".into(), json!(p.type_));
    o.insert("crates".into(), json!(p.crates));
    o.insert("exclusive".into(), json!(p.exclusive));
    o.insert("hp".into(), json!(p.hp));
    o.insert("attack".into(), json!(p.attack.clone().unwrap_or_default()));
    o.insert("dmg".into(), json!(p.dmg));
    o.insert("attack2".into(), json!(p.attack2.clone().unwrap_or_default()));
    o.insert("dmg2".into(), json!(p.dmg2));
    o.insert("kind1".into(), json!(p.kind1));
    o.insert("kind2".into(), json!(p.kind2));
    o.insert("abilities".into(), json!(p.abilities));
    o.insert("wikiLang".into(), json!(lang));
    o.insert("wikiTitle".into(), json!(title));
    o.insert("country".into(), json!(p.country));
    o.insert("subtitle".into(), json!(p.subtitle));
    o.insert("desc".into(), json!(p.desc));
    if full {
        o.insert("arena".into(), json!(p.arena));
        o.insert("texts".into(), json!(p.texts));
        if !p.vx.is_empty() {
            o.insert("vx".into(), json!(p.vx));
        }
        o.insert("source".into(), json!(p.source));
        o.insert("fixedVariant".into(), json!(p.fixed_variant));
        o.insert("style".into(), json!(p.style));
        o.insert("bibi".into(), json!(p.bibi));
    }
    Value::Object(o)
}

fn csv_header() -> Vec<String> {
    let mut h: Vec<String> = CSV_COLUMNS.iter().map(|c| (*c).to_owned()).collect();
    for n in 1..=g().max_extra_abilities {
        h.extend(["name", "kind", "value"].map(|k| format!("ability{n}{k}")));
    }
    h
}

fn csv_row(card: &Value) -> Vec<String> {
    let cell = |k: &str| match &card[k] {
        Value::Array(a) => a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(";"),
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    };
    let mut row: Vec<String> = CSV_COLUMNS.iter().map(|c| cell(c)).collect();
    let abilities = card["abilities"].as_array().cloned().unwrap_or_default();
    for n in 0..g().max_extra_abilities {
        let a = abilities.get(n).cloned().unwrap_or(Value::Null);
        row.extend(["name", "kind", "value"].map(|k| match &a[k] {
            Value::String(s) => s.clone(),
            Value::Number(x) => x.to_string(),
            _ => String::new(),
        }));
    }
    row
}

fn file_response(cards: Vec<Value>, format: &str, base: &str) -> Response {
    let (body, mime, ext) = if format == "csv" {
        let mut rows = vec![csv_header()];
        rows.extend(cards.iter().map(csv_row));
        (csv_write(&rows), "text/csv; charset=utf-8", "csv")
    } else {
        let doc = json!({"format": "scambox-cards", "version": 1, "cards": cards});
        (serde_json::to_string_pretty(&doc).unwrap_or_default(), "application/json; charset=utf-8", "json")
    };
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime.to_owned()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{base}.{ext}\"")),
            (header::CACHE_CONTROL, "no-store".to_owned()),
        ],
        body,
    )
        .into_response()
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ExportBody {
    /// "json" (wszystkie pola, także Arena i napisy) albo "csv" (płaska tabela)
    format: String,
    /// tylko karty z tej skrzynki
    #[serde(rename = "crate")]
    crate_: String,
    /// tylko te karty; puste = wszystkie (z filtrem skrzynki)
    ids: Vec<String>,
}

/// Karty z gry do pliku. POST, bo lista wybranych kart bywa długa.
pub async fn admin_export_cards(State(st): State<AppState>, Admin(_): Admin, JsonBody(q): JsonBody<ExportBody>) -> Res {
    let cat = st.cat();
    let ids: HashSet<&str> = q.ids.iter().map(String::as_str).collect();
    let format = if q.format == "csv" { "csv" } else { "json" };
    let cards: Vec<Value> = cat
        .people
        .values()
        .filter(|p| (q.crate_.is_empty() || p.crates.contains(&q.crate_)) && (ids.is_empty() || ids.contains(p.id.as_str())))
        .map(|p| card_value(p, format == "json"))
        .collect();
    Ok(file_response(cards, format, if q.crate_.is_empty() { "scambox-karty" } else { &q.crate_ }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct TemplateQuery {
    format: String,
}

/// Wzór pliku do wypełnienia: dwie przykładowe karty
pub async fn admin_cards_template(Admin(_): Admin, Query(q): Query<TemplateQuery>) -> Res {
    let format = if q.format == "csv" { "csv" } else { "json" };
    let mut sample = json!({
        "name": "Jan Kowalski", "rarity": "green", "type": "polityka", "crates": ["pl"], "hp": 60, "attack": "Przemówienie", "dmg": 40,
        "wikiLang": "pl", "wikiTitle": "Jan Kowalski", "subtitle": "Przykładowa karta", "desc": "Dowolny opis karty.",
        "abilities": [{"name": "Poparcie", "kind": "heal", "value": 20}], "kind1": "off", "kind2": "off",
    });
    let mut second = sample.clone();
    second["name"] = json!("Anna Nowak");
    second["attack"] = json!("Wywiad");
    second["wikiTitle"] = json!("");
    second["abilities"] = json!([]);
    if format == "json" {
        sample["id"] = json!("");
        second["id"] = json!("");
    }
    Ok(file_response(vec![sample, second], format, "scambox-karty-wzor"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_roundtrip_with_quotes_and_newlines() {
        let rows = vec![vec!["a".into(), "b,c".into(), "x\"y".into()], vec!["z".into(), "linia1\nlinia2".into(), "".into()]];
        assert_eq!(csv_parse(&csv_write(&rows)), rows);
    }

    #[test]
    fn csv_detects_semicolon_and_skips_blank_rows() {
        let t = csv_parse("\u{feff}name;rarity\r\nJan;green\r\n\r\n\"A;B\";blue\r\n");
        assert_eq!(t, vec![vec!["name", "rarity"], vec!["Jan", "green"], vec!["A;B", "blue"]]);
    }

    #[test]
    fn row_names_resolve_and_defaults_apply() {
        let cat = catalog::build(&[], &[]);
        let opts = Opts { default_crate: Some("pl".into()), update_existing: true, skip_existing: true };
        let row = json!({"Nazwa": "Testowy Gracz", "rzadkosc": "Epicka", "typ": "polityka", "ability1name": "Cios", "ability1kind": "def", "ability1value": "30"});
        let mut batch = Batch::default();
        let Ok(Outcome::Save(p)) = prepare(&row, &cat, &opts, &mut batch) else { panic!("powinno się zapisać") };
        assert!(p.is_new && p.pid.starts_with("pl_testowy_gracz"));
        assert_eq!(p.fields["rarity"], json!("purple"));
        assert_eq!((p.fields["hp"].clone(), p.fields["crate"].clone()), (json!(50), json!("pl")));
        assert_eq!(p.fields["abilities"][0]["name"], json!("Cios"));
        // ten sam plik drugi raz: ta sama nazwa w tej samej skrzynce jest pomijana dopiero po zapisie, ale zły typ to błąd
        let bad_row = json!({"name": "X", "rarity": "green", "type": "nie_ma"});
        assert!(prepare(&bad_row, &cat, &opts, &mut batch).is_err());
    }

    #[test]
    fn export_import_roundtrip_for_builtin_card() {
        let cat = catalog::build(&[], &[]);
        let p = cat.person("pl_tusk").unwrap();
        for full in [true, false] {
            let value = card_value(p, full);
            let opts = Opts { default_crate: None, update_existing: true, skip_existing: true };
            let Ok(Outcome::Save(prep)) = prepare(&value, &cat, &opts, &mut Batch::default()) else { panic!("brak zapisu") };
            assert!(!prep.is_new);
            assert_eq!(prep.fields["name"], json!(p.name));
            assert_eq!(prep.fields["hp"], json!(p.hp));
        }
        // CSV: wiersz z eksportu wraca jako ta sama karta
        let mut rows = vec![csv_header()];
        rows.push(csv_row(&card_value(p, false)));
        let back = rows_from_text("csv", &csv_write(&rows)).unwrap();
        let opts = Opts { default_crate: None, update_existing: true, skip_existing: true };
        let Ok(Outcome::Save(prep)) = prepare(&back[0], &cat, &opts, &mut Batch::default()) else { panic!("brak zapisu CSV") };
        assert_eq!(prep.pid, p.id);
        assert_eq!(prep.fields["rarity"], json!(p.rarity));
    }
}
