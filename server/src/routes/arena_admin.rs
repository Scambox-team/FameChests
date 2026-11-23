//! Panel admina „Arena” (`/admin/arena`): ustawienia meczu, dostęp dla wszystkich, klasy, specjalizacje, ukryte cechy,
//! układy, domyślne statystyki rzadkości / specjalizacji i statystyki kart. Uprawnienie rangi: `games`.

use axum::extract::{Path, State};
use serde::Deserialize;
use serde_json::{json, Value};

use super::arena::kinds_json;
use super::{ok, JsonBody};
use crate::arena::rules::{self, CardStats, Meta, Settings, PUBLIC_KEY, SPECIALS, TRAITS};
use crate::auth::Admin;
use crate::error::{bad, Res};
use crate::game::log_admin;
use crate::state::AppState;

fn panel_json(st: &AppState) -> Value {
    let cat = st.cat();
    let d = rules::data();
    json!({
        "public": d.public,
        "settings": d.settings,
        "defaults": {"settings": Settings::default(), "meta": Meta::default()},
        "meta": d.meta,
        "traits": TRAITS.iter().map(|(k, n)| json!({"id": k, "name": n})).collect::<Vec<_>>(),
        "kinds": kinds_json(),
        "specials": SPECIALS.iter().map(|(k, n, desc)| json!({"id": k, "name": n, "desc": desc})).collect::<Vec<_>>(),
        "cards": rules::all_cards(&cat, &d),
        "rarities": crate::data::g().rarities.iter().map(|(k, r)| json!({"id": k, "name": r.name})).collect::<Vec<_>>(),
        "crates": cat.crates.iter().map(|(k, c)| json!({"id": k, "name": c.name})).collect::<Vec<_>>(),
    })
}

pub async fn admin_arena(State(st): State<AppState>, Admin(_): Admin) -> Res {
    ok(panel_json(&st))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsReq {
    settings: Option<Settings>,
    public: Option<bool>,
    /// true = ustawienia meczu jak w kodzie
    #[serde(default)]
    reset: bool,
}

pub async fn admin_arena_settings(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<SettingsReq>) -> Res {
    let mut tx = st.db.begin().await?;
    if req.reset {
        sqlx::query("DELETE FROM arena_config WHERE key = 'settings'").execute(&mut *tx).await?;
    } else if let Some(s) = req.settings {
        rules::save_config(&mut tx, "settings", &json!(s.clean())).await?;
    }
    if let Some(p) = req.public {
        sqlx::query("INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
            .bind(PUBLIC_KEY)
            .bind(i64::from(p))
            .execute(&mut *tx)
            .await?;
    }
    log_admin(&mut tx, &me, "arena_settings", None, &format!("public={:?} reset={}", req.public, req.reset)).await?;
    tx.commit().await?;
    rules::load(&mut *st.db.acquire().await?).await?;
    ok(panel_json(&st))
}

#[derive(Deserialize)]
pub struct MetaReq {
    meta: Option<Meta>,
    #[serde(default)]
    reset: bool,
}

/// Słowniki: klasy, specjalizacje (z domyślnymi statystykami), ukryte cechy, układy, domyślne statystyki rzadkości
pub async fn admin_arena_meta(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<MetaReq>) -> Res {
    let mut c = st.db.acquire().await?;
    if req.reset {
        sqlx::query("DELETE FROM arena_config WHERE key = 'meta'").execute(&mut *c).await?;
    } else if let Some(m) = req.meta {
        rules::save_config(&mut c, "meta", &json!(m.clean())).await?;
    } else {
        return bad("Brak danych");
    }
    log_admin(&mut c, &me, "arena_meta", None, if req.reset { "reset" } else { "zapis" }).await?;
    rules::load(&mut c).await?;
    ok(panel_json(&st))
}

#[derive(Deserialize)]
pub struct CardReq {
    stats: Option<CardStats>,
    /// true = usuń wpis (karta wraca do statystyk z rzadkości)
    #[serde(default)]
    reset: bool,
}

pub async fn admin_arena_card(State(st): State<AppState>, Admin(me): Admin, Path(pid): Path<String>, JsonBody(req): JsonBody<CardReq>) -> Res {
    let cat = st.cat();
    if cat.person(&pid).is_none() {
        return bad("Nie ma takiej karty");
    }
    let d = rules::data();
    let mut c = st.db.acquire().await?;
    if req.reset {
        sqlx::query("DELETE FROM arena_cards WHERE person_id = $1").bind(&pid).execute(&mut *c).await?;
    } else if let Some(s) = req.stats {
        rules::save_cards(&mut c, &[(pid.clone(), s.clean(&d.meta))]).await?;
    } else {
        return bad("Brak danych");
    }
    log_admin(&mut c, &me, "arena_card", None, &pid).await?;
    rules::load(&mut c).await?;
    let d = rules::data();
    let p = cat.person(&pid).expect("karta sprawdzona wyżej");
    let s = d.stats(p);
    ok(json!({"id": pid, "points": d.points(p, &s), "custom": d.cards.contains_key(&pid), "stats": s}))
}

#[derive(Deserialize)]
pub struct ApplyReq {
    /// hp / atk / range
    stat: String,
    /// rarity / spec
    source: String,
}

/// „Zastosuj do wszystkich”: domyślna statystyka z rzadkości albo specjalizacji trafia do każdej karty
/// (ostatnie zastosowanie danej statystyki wygrywa)
pub async fn admin_arena_apply(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<ApplyReq>) -> Res {
    if !matches!(req.stat.as_str(), "hp" | "atk" | "range") || !matches!(req.source.as_str(), "rarity" | "spec") {
        return bad("Nieznana statystyka albo źródło");
    }
    let cat = st.cat();
    let d = rules::data();
    let changed = rules::apply_defaults(cat.people.values().map(AsRef::as_ref), &d, &req.stat, &req.source);
    let mut tx = st.db.begin().await?;
    for chunk in changed.chunks(500) {
        rules::save_cards(&mut tx, chunk).await?;
    }
    log_admin(&mut tx, &me, "arena_apply", None, &format!("{} z {}: {} kart", req.stat, req.source, changed.len())).await?;
    tx.commit().await?;
    rules::load(&mut *st.db.acquire().await?).await?;
    let mut v = panel_json(&st);
    v["applied"] = json!(changed.len());
    ok(v)
}

#[cfg(test)]
mod tests {
    use crate::arena::rules::{apply_defaults, ArenaData, CardStats, Meta};

    #[test]
    fn apply_rarity_then_spec() {
        // przykład z wymagań: Rzadka (HP 80, atak 70) + Bokser (HP 85, atak 65): HP z rzadkości, atak ze specjalizacji
        let mut meta = Meta::default();
        let r = meta.rarity_defaults.get_mut("blue").unwrap();
        r.hp = Some(80);
        r.atk = Some(70);
        let b = meta.specs.iter_mut().find(|s| s.id == "boxer").unwrap();
        b.defaults.hp = Some(85);
        b.defaults.atk = Some(65);
        let p = crate::catalog::tests_person("x", "blue");
        let q = crate::catalog::tests_person("y", "blue");
        let mut d = ArenaData { meta, ..ArenaData::default() };
        d.cards.insert("x".into(), CardStats { spec: "boxer".into(), hp: 1, atk: 1, ..CardStats::default() });
        let people = [p, q];
        for (stat, source) in [("hp", "rarity"), ("atk", "spec"), ("atk", "rarity")] {
            for (id, s) in apply_defaults(people.iter(), &d, stat, source) {
                d.cards.insert(id, s);
            }
            if (stat, source) == ("atk", "spec") {
                assert_eq!((d.cards["x"].hp, d.cards["x"].atk), (80, 65));
                assert_eq!(d.stats(&people[1]).atk, 70); // bez specjalizacji: atak bez zmian (z rzadkości)
            }
        }
        // ostatnie zastosowanie wygrywa: atak z rzadkości nadpisuje atak ze specjalizacji
        assert_eq!(d.cards["x"].atk, 70);
        assert_eq!(d.cards["y"].hp, 80);
    }
}
