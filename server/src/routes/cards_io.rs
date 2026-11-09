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

/// Tabela z tekstu CSV (linie zaczynające się od `#` to komentarze): separator `,` `;` albo tabulator (rozpoznany po nagłówku), cudzysłowy, BOM i znaki nowej linii w polach
pub fn csv_parse(text: &str) -> Vec<Vec<String>> {
    let text = text.trim_start_matches('\u{feff}');
    // linie komentarza (`# ...`) i puste nie liczą się do nagłówka
    let head = text.lines().find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#')).unwrap_or("");
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
            // komentarz: `#` na początku wiersza (poza cudzysłowem) - reszta linii jest pomijana
            '#' if !quoted && !was_quoted && field.is_empty() && row.is_empty() => {
                while chars.peek().is_some_and(|&n| n != '\n') {
                    chars.next();
                }
            }
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
    download(body, mime, ext, base)
}

fn download(body: String, mime: &str, ext: &str, base: &str) -> Response {
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

/// Id bez powtórzeń, w kolejności pierwszego wystąpienia.
fn unique_in_order(ids: &[String]) -> Vec<&str> {
    let mut seen = HashSet::new();
    ids.iter().map(String::as_str).filter(|id| seen.insert(*id)).collect()
}

/// Karty z gry do pliku. POST, bo lista wybranych kart bywa długa.
pub async fn admin_export_cards(State(st): State<AppState>, Admin(_): Admin, JsonBody(q): JsonBody<ExportBody>) -> Res {
    let cat = st.cat();
    let format = if q.format == "csv" { "csv" } else { "json" };
    let in_crate = |p: &Person| q.crate_.is_empty() || p.crates.contains(&q.crate_);
    let cards: Vec<Value> = if q.ids.is_empty() {
        cat.people.values().filter(|p| in_crate(p)).map(|p| card_value(p, format == "json")).collect()
    } else {
        // kolejność jak w `ids` (tak, jak admin posortował wyniki); nieznane id pomijamy, karty ukryte też
        unique_in_order(&q.ids).into_iter().filter_map(|id| cat.people.get(id)).filter(|p| in_crate(p)).map(|p| card_value(p, format == "json")).collect()
    };
    Ok(file_response(cards, format, if q.crate_.is_empty() { "scambox-karty" } else { &q.crate_ }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct TemplateQuery {
    format: String,
}

// ---------------------------------------------------------------- wzór pliku z listami dozwolonych wartości

/// Opis jednego pola karty we wzorze (dla człowieka i dla modelu AI)
struct Spec {
    key: &'static str,
    desc: String,
    required: bool,
    kind: &'static str,
    /// (wartość, nazwa) - tylko pola o zamkniętej liście
    allowed: Vec<(String, String)>,
    /// pole tylko w JSON (nie ma kolumny w CSV)
    json_only: bool,
}

fn spec(key: &'static str, kind: &'static str, required: bool, desc: impl Into<String>) -> Spec {
    Spec { key, desc: desc.into(), required, kind, allowed: vec![], json_only: false }
}

impl Spec {
    fn allowed(mut self, a: Vec<(String, String)>) -> Self {
        self.allowed = a;
        self
    }
    fn json_only(mut self) -> Self {
        self.json_only = true;
        self
    }
}

fn crate_choices(cat: &Catalog) -> Vec<(String, String)> {
    cat.crates.values().filter(|c| !c.special).map(|c| (c.id.clone(), c.name.clone())).collect()
}

/// Opisy pól z AKTUALNEGO katalogu: rzadkości, typy, skrzynki (także dodane w panelu), rodzaje zdolności, warianty i źródła
fn field_specs(cat: &Catalog) -> Vec<Spec> {
    let g = g();
    let crates = crate_choices(cat);
    let rarities: Vec<(String, String)> = g.rarities.iter().map(|(k, d)| (k.clone(), d.name.clone())).collect();
    let types: Vec<(String, String)> =
        g.types.keys().map(|k| (k.clone(), g.types_json[k]["name"].as_str().unwrap_or(k).to_owned())).collect();
    let kinds: Vec<(String, String)> = g
        .ability_kinds
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, v)| {
            let hint = match k.as_str() {
                "heal" => "value = ile HP leczy",
                "eco" => "value = ile monet daje w Arenie",
                "off" => "value = siła ofensywna",
                "def" => "value = siła obronna",
                _ => "value = siła zdolności",
            };
            (k.clone(), format!("{} ({hint})", v["name"].as_str().unwrap_or(k)))
        })
        .collect();
    let sources: Vec<(String, String)> = g.special_sources.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let variants: Vec<(String, String)> =
        g.special_variants.iter().map(|k| (k.clone(), g.variants.get(k).map_or_else(|| k.clone(), |v| v.name.clone()))).collect();
    let slots: Vec<(String, String)> = g.card_text_slots.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let yes_no = vec![("true".to_owned(), "tak".to_owned()), ("false".to_owned(), "nie".to_owned())];
    let special = &g.special_crate;
    let abil = format!(
        "Zdolności dodatkowe, najwyżej {n}. Każda: name (tekst, do 40 znaków), kind (rodzaj z listy), value (liczba 0-9999). W CSV kolumny ability<n>name / ability<n>kind / ability<n>value, n = 1..{n}.",
        n = g.max_extra_abilities
    );
    vec![
        spec(
            "id",
            "tekst",
            false,
            "Identyfikator karty: małe litery bez polskich znaków, cyfry i _ (najwyżej 60 znaków). PUSTE lub BRAK = nowa karta, id nada serwer - nie wymyślaj go. \
             Podanie id istniejącej karty zmienia tylko podane pola tej karty.",
        ),
        spec("name", "tekst", true, "Nazwa karty (najwyżej 60 znaków)."),
        spec("rarity", "lista", true, "Rzadkość karty. Podaj klucz albo nazwę z listy. Karta „special” trafia tylko do skrzynki kart specjalnych.")
            .allowed(rarities),
        spec("type", "lista", true, "Typ (kategoria) karty. Podaj klucz albo nazwę z listy.").allowed(types),
        spec(
            "crates",
            "lista (wiele)",
            true,
            format!(
                "Skrzynki, w których jest karta; pierwsza jest główną. W JSON tablica, w CSV jedna komórka rozdzielona średnikiem (np. pl;world). \
                 Podaj id albo nazwę. Gdy brak, użyta będzie skrzynka domyślna wybrana przy imporcie. Karta „special” zawsze trafia do skrzynki „{special}” (nie podawaj jej)."
            ),
        )
        .allowed(crates.clone()),
        spec("exclusive", "lista (wiele)", false, "Skrzynki (spośród crates), w których karta jest ekskluzywna. Zwykle puste.").allowed(crates),
        spec("hp", "liczba całkowita", false, "Punkty życia, 0-9999 (domyślnie 50 dla nowej karty)."),
        spec("attack", "tekst", false, "Nazwa ataku (najwyżej 40 znaków; domyślnie „Atak”)."),
        spec("dmg", "liczba całkowita", false, "Obrażenia ataku, 0-9999 (domyślnie 30)."),
        spec("attack2", "tekst", false, "Nazwa drugiego ataku (najwyżej 40 znaków); puste = karta nie ma drugiego ataku."),
        spec("dmg2", "liczba całkowita", false, "Obrażenia drugiego ataku, 0-9999 (domyślnie 0)."),
        spec("kind1", "lista", false, "Rodzaj pierwszej (głównej) zdolności w Arenie; domyślnie off.").allowed(kinds.clone()),
        spec("kind2", "lista", false, "Rodzaj drugiej zdolności w Arenie; domyślnie off.").allowed(kinds.clone()),
        spec("abilities", "lista obiektów {name, kind, value}", false, abil).allowed(kinds),
        spec("wikiLang", "tekst", false, "Język Wikipedii, z której pobrać zdjęcie: kod 2-5 znaków, np. pl, en, de (domyślnie pl)."),
        spec("wikiTitle", "tekst", false, "Dokładny tytuł artykułu w Wikipedii, z którego serwer pobierze zdjęcie. Puste = bez zdjęcia z Wikipedii."),
        spec(
            "country",
            "tekst",
            false,
            "Kraj jako dwuliterowy kod ISO 3166-1 małymi literami, np. pl, de, us, gb (opcjonalnie z regionem, np. gb-eng). Nieprawidłowa wartość = brak kraju.",
        ),
        spec("subtitle", "tekst", false, format!("Podtytuł wyświetlany na karcie (najwyżej {} znaków).", catalog::SUBTITLE_MAX)),
        spec("desc", "tekst", false, format!("Opis karty (najwyżej {} znaków).", catalog::DESC_MAX)),
        spec("imageUrl", "tekst", false, "Adres (https://...) zdjęcia do pobrania; ma pierwszeństwo przed zdjęciem z Wikipedii."),
        spec("source", "lista", false, "Tylko dla kart „special”: skąd karta pochodzi.").allowed(sources).json_only(),
        spec("fixedVariant", "lista", false, "Tylko dla kart „special”: jedyny wariant wyglądu karty.").allowed(variants).json_only(),
        spec("style", "liczba całkowita", false, "Tylko dla kart „special”: numer wyglądu w wariancie, od 1 (zbyt duży numer zostanie przycięty).").json_only(),
        spec("bibi", "tak/nie", false, "Znacznik pomocniczy karty (true/false).").allowed(yes_no).json_only(),
        spec("texts", "obiekt {miejsce: tekst}", false, "Własne napisy na karcie; klucze to miejsca z listy. Zwykle pomiń.").allowed(slots).json_only(),
        spec("arena", "lista obiektów", false, "Zaawansowane: ustawienia zdolności w Arenie (jak w eksporcie JSON). Nowe karty: pomiń.").json_only(),
        spec("vx", "obiekt", false, "Zaawansowane: ustawienia wariantów tylko dla tej karty. Nowe karty: pomiń.").json_only(),
    ]
}

const TEMPLATE_INFO: &str = "WZÓR IMPORTU KART gry ScamBox. Wypełnij listę kart zgodnie z opisem pól w „_pola”. \
Pola o zamkniętej liście (rarity, type, crates, kind1, kind2, kind w zdolnościach, source, fixedVariant) przyjmują albo KLUCZ (pole „wartosc”), albo NAZWĘ (pole „nazwa”) \
z listy „dozwolone” - użyj dokładnie tych wartości, nie wymyślaj nowych. Brak „id” (puste) = nowa karta, id nada serwer; nie wymyślaj id. \
Pola opcjonalne można pominąć (zostaną wartości domyślne). Klucze zaczynające się od „_” (także „_instrukcja” i „_pola”) są ignorowane przy imporcie. \
Odpowiedz plikiem JSON w formie {\"format\": \"scambox-cards\", \"cards\": [ ... ]} albo samą listą kart. Najwięcej 500 kart w pliku.";

fn pola_json(specs: &[Spec]) -> Value {
    let mut o = Map::new();
    for s in specs {
        let mut f = Map::new();
        f.insert("opis".into(), json!(s.desc));
        f.insert("wymagane".into(), json!(s.required));
        f.insert("typ".into(), json!(s.kind));
        if !s.allowed.is_empty() {
            f.insert("dozwolone".into(), json!(s.allowed.iter().map(|(k, n)| json!({"wartosc": k, "nazwa": n})).collect::<Vec<_>>()));
        }
        o.insert(s.key.into(), Value::Object(f));
    }
    Value::Object(o)
}

/// Dwie przykładowe karty z prawdziwymi wartościami z list (pierwsza zwykła rzadkość, pierwszy typ, pierwsza skrzynka...)
fn sample_cards(cat: &Catalog) -> (Value, Value) {
    let g = g();
    let rarity = g.rarities.keys().find(|k| !matches!(k.as_str(), "special" | "secret")).or(g.rarities.keys().next()).cloned().unwrap_or_default();
    let type_ = g.types.keys().next().cloned().unwrap_or_default();
    let crate_ = crate_choices(cat).into_iter().next().map(|c| c.0).unwrap_or_default();
    let kinds = g.ability_kinds.as_object();
    let kind = match kinds {
        Some(o) if o.contains_key("heal") => "heal".to_owned(),
        Some(o) => o.keys().next().cloned().unwrap_or_else(|| "off".into()),
        None => "off".into(),
    };
    let first = json!({
        "name": "Jan Kowalski", "rarity": rarity, "type": type_, "crates": [crate_], "hp": 60, "attack": "Przemówienie", "dmg": 40,
        "wikiLang": "pl", "wikiTitle": "Jan Kowalski", "subtitle": "Przykładowa karta", "desc": "Dowolny opis karty.",
        "abilities": [{"name": "Poparcie", "kind": kind, "value": 20}], "kind1": "off", "kind2": "off",
    });
    let mut second = first.clone();
    second["name"] = json!("Anna Nowak");
    second["attack"] = json!("Wywiad");
    second["wikiTitle"] = json!("");
    second["abilities"] = json!([]);
    (first, second)
}

fn template_json(cat: &Catalog) -> String {
    let (a, b) = sample_cards(cat);
    let with_id = |c: Value| {
        let mut o = Map::new();
        o.insert("id".into(), json!(""));
        o.extend(c.as_object().cloned().unwrap_or_default());
        Value::Object(o)
    };
    let doc = json!({
        "_instrukcja": TEMPLATE_INFO,
        "_pola": pola_json(&field_specs(cat)),
        "format": "scambox-cards", "version": 1, "cards": [with_id(a), with_id(b)],
    });
    serde_json::to_string_pretty(&doc).unwrap_or_default()
}

/// Linie komentarza `#` na początku wzoru CSV: instrukcja i lista dozwolonych wartości każdej kolumny
fn template_csv_comments(cat: &Catalog) -> String {
    let mut out = vec![
        "# WZÓR IMPORTU KART gry ScamBox (CSV). Linie zaczynające się od # i puste linie są pomijane przy imporcie.".to_owned(),
        "# Pierwsza linia bez # to nagłówek kolumn - zostaw ją bez zmian. Każda następna to jedna karta.".to_owned(),
        "# Separator: przecinek, średnik albo tabulator (jeden w całym pliku). Kodowanie UTF-8. Pole z separatorem lub nowym wierszem ujmij w cudzysłów.".to_owned(),
        "# Pola z listy przyjmują KLUCZ albo NAZWĘ z listy poniżej - użyj dokładnie tych wartości. Wiele skrzynek w jednej komórce rozdziel średnikiem (np. pl;world).".to_owned(),
        "# Puste id = nowa karta (id nada serwer, nie wymyślaj go). Kolumny opcjonalne można zostawić puste. Komórka w pierwszej kolumnie nie może zaczynać się od #.".to_owned(),
    ];
    for s in field_specs(cat).iter().filter(|s| !s.json_only) {
        let label = if s.key == "abilities" { "ability<n>name / ability<n>kind / ability<n>value" } else { s.key };
        out.push(format!("# {label}: {}{}. {}", s.kind, if s.required { ", wymagane" } else { "" }, s.desc));
        if !s.allowed.is_empty() {
            let key = if s.key == "abilities" { "kind" } else { s.key };
            out.push(format!("# {key}: {}", s.allowed.iter().map(|(k, n)| format!("{k} ({n})")).collect::<Vec<_>>().join(" | ")));
        }
    }
    out.join("\r\n") + "\r\n"
}

fn template_csv(cat: &Catalog) -> String {
    let (a, b) = sample_cards(cat);
    let table = csv_write(&[csv_header(), csv_row(&a), csv_row(&b)]);
    // BOM zostaje na początku pliku, komentarze idą zaraz za nim
    format!("\u{feff}{}{}", template_csv_comments(cat), table.trim_start_matches('\u{feff}'))
}

/// Wzór pliku do wypełnienia: dwie przykładowe karty i listy dozwolonych wartości (z aktualnego katalogu)
pub async fn admin_cards_template(State(st): State<AppState>, Admin(_): Admin, Query(q): Query<TemplateQuery>) -> Res {
    let cat = st.cat();
    let (body, mime, ext) = if q.format == "csv" {
        (template_csv(&cat), "text/csv; charset=utf-8", "csv")
    } else {
        (template_json(&cat), "application/json; charset=utf-8", "json")
    };
    Ok(download(body, mime, ext, "scambox-karty-wzor"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_ids_keep_requested_order_without_duplicates() {
        let ids: Vec<String> = ["c", "a", "c", "b", "a"].map(String::from).to_vec();
        assert_eq!(unique_in_order(&ids), vec!["c", "a", "b"]);
    }

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

    #[test]
    fn json_template_lists_allowed_values_and_imports() {
        let cat = catalog::build(&[], &[]);
        let doc: Value = serde_json::from_str(&template_json(&cat)).unwrap();
        assert!(doc["_instrukcja"].as_str().is_some_and(|t| t.contains("id")));
        let rar = doc["_pola"]["rarity"]["dozwolone"].as_array().unwrap();
        assert!(rar.iter().any(|r| r["wartosc"] == "green" && r["nazwa"] == "Zwykła"));
        assert!(doc["_pola"]["name"]["dozwolone"].is_null() && doc["_pola"]["name"]["wymagane"] == json!(true));
        assert!(!doc["_pola"]["crates"]["dozwolone"].as_array().unwrap().is_empty());
        // plik ze wzoru (z kluczami `_`) przechodzi sprawdzanie wierszy
        let rows = rows_from_text("json", &template_json(&cat)).unwrap();
        assert_eq!(rows.len(), 2);
        let opts = Opts { default_crate: None, update_existing: true, skip_existing: true };
        let mut batch = Batch::default();
        for r in &rows {
            assert!(matches!(prepare(r, &cat, &opts, &mut batch), Ok(Outcome::Save(_))));
        }
        // klucz `_` w karcie jest ignorowany
        let mut row = rows[0].clone();
        row["_uwaga"] = json!("cokolwiek");
        assert!(prepare(&row, &cat, &opts, &mut Batch::default()).is_ok());
    }

    #[test]
    fn csv_template_with_comments_parses() {
        let cat = catalog::build(&[], &[]);
        let csv = template_csv(&cat);
        assert!(csv.starts_with('\u{feff}'));
        assert!(csv.contains("# rarity: green (Zwykła)"));
        let rows = rows_from_text("csv", &csv).unwrap();
        assert_eq!(rows.len(), 2);
        let opts = Opts { default_crate: None, update_existing: true, skip_existing: true };
        let mut batch = Batch::default();
        for r in &rows {
            assert!(matches!(prepare(r, &cat, &opts, &mut batch), Ok(Outcome::Save(_))));
        }
        // komentarze przed i po nagłówku oraz puste linie
        let t = csv_parse("# a, b\n\n#c\nname;rarity\n# w środku\nJan;green\n");
        assert_eq!(t, vec![vec!["name", "rarity"], vec!["Jan", "green"]]);
    }
}
