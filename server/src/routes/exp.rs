//! Doświadczenie i levele (src/exp.rs): strona „Poziom” gracza (`/api/exp`), okienka nowych leveli (`/api/exp/pop`) i panel admina
//! (ustawienia źródeł EXP, krzywa, nagrody leveli, rozkład graczy, ręczne nadanie EXP / levelu).

use std::collections::HashMap;

use axum::extract::State;
use serde::Deserialize;
use serde_json::{json, Value};

use super::events::{reward_options, reward_view};
use super::{ok, JsonBody};
use crate::auth::{Admin, Me};
use crate::db::lock_me;
use crate::error::{bad, Res};
use crate::exp::{self, clean_config, default_rewards, ExpConfig, BADGE_TIERS, CHOICE_OPTIONS, CHOICE_PICKS, DEFAULT_CURVE, DEFAULT_DECAY, MAX_LEVEL, SOURCES};
use crate::game::{get_chests, get_state, log_admin, Ctx};
use crate::state::AppState;

fn views(cat: &crate::catalog::Catalog, list: &[Value]) -> Vec<Value> {
    list.iter().filter(|r| exp::usable(cat, r)).map(|r| reward_view(cat, r)).collect()
}

/// Strona „Poziom”: postęp, wszystkie levele z nagrodami (odebrane / następne) i tabela źródeł EXP z aktualnymi wartościami
pub async fn exp_page(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let cfg = exp::config();
    let mut c = st.db.acquire().await?;
    let mine = exp::me_view(&mut c, me.id).await?;
    let cycle = mine["cycle"].as_i64().unwrap_or(0);
    let claims: HashMap<i64, bool> = sqlx::query_as::<_, (i32, i16)>("SELECT level, paid FROM level_claims WHERE user_id = $1 AND cycle = $2")
        .bind(me.id)
        .bind(cycle as i32)
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .map(|(l, p)| (i64::from(l), p != 0))
        .collect();
    let levels: Vec<Value> = (1..=MAX_LEVEL)
        .map(|l| {
            let r = cfg.rewards_for(l);
            json!({
                "level": l, "need": if l < MAX_LEVEL { cfg.need(l) } else { 0 }, "total": cfg.total_for(l),
                "small": views(&cat, &r.small), "special": views(&cat, &r.special),
                "claimed": claims.contains_key(&l) || l == 1, "paid": claims.get(&l).copied().unwrap_or(l != 1),
                "big": cfg.choice_levels.contains(&l),
            })
        })
        .collect();
    let sources: Vec<Value> = SOURCES
        .iter()
        .filter_map(|s| {
            let (e, cap) = *cfg.sources.get(s.key)?;
            let exp = (e as f64 * cfg.mult).round() as i64;
            (exp > 0).then(|| json!({"key": s.key, "group": s.group, "name": s.name, "exp": exp, "cap": cap}))
        })
        .collect();
    let badges = exp::all_badges(&mut c, me.id).await?;
    let choices = pending_view(&mut c, &cat, me.id).await?;
    ok(json!({"me": mine, "levels": levels, "sources": sources, "badges": badges, "choices": choices, "badgeTiers": BADGE_TIERS,
              "choicePicks": CHOICE_PICKS, "choiceOptions": CHOICE_OPTIONS, "decay": cfg.decay}))
}

/// Duże nagrody czekające na wybór (opcje jako opisy nagród)
async fn pending_view(c: &mut crate::db::Conn, cat: &crate::catalog::Catalog, uid: i64) -> sqlx::Result<Vec<Value>> {
    Ok(exp::pending_choices(c, uid)
        .await?
        .into_iter()
        .map(|(cycle, level, options)| {
            let opts: Vec<Value> = options
                .iter()
                .map(|o| json!({"slot": o["slot"], "exclusive": o["exclusive"], "reward": reward_view(cat, &o["reward"])}))
                .collect();
            json!({"cycle": cycle, "level": level, "options": opts})
        })
        .collect())
}

/// Duże nagrody do wybrania (okno wyboru 2 z 4)
pub async fn exp_choices(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    ok(json!({"choices": pending_view(&mut c, &cat, me.id).await?, "picks": CHOICE_PICKS}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ChooseRequest {
    cycle: i64,
    level: i64,
    /// numery wybranych opcji (0-3) - dokładnie `CHOICE_PICKS`
    picks: Vec<i64>,
}

/// Wybór dwóch z czterech opcji dużej nagrody: opcje pochodzą z bazy (wylosowane przy zdobyciu levelu), z przeglądarki przychodzą tylko
/// numery; pozostałe opcje przepadają. Raz na (cykl, level).
pub async fn exp_choose(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<ChooseRequest>) -> Res {
    let mut picks = req.picks.clone();
    picks.sort_unstable();
    picks.dedup();
    if picks.len() != CHOICE_PICKS || picks.iter().any(|p| !(0..CHOICE_OPTIONS as i64).contains(p)) {
        return bad(format!("Wybierz dokładnie {CHOICE_PICKS} z {CHOICE_OPTIONS} nagród"));
    }
    let cx = Ctx::new(st.clone(), me.clone());
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let row: Option<(String, i16)> = sqlx::query_as("SELECT options, done FROM level_choices WHERE user_id = $1 AND cycle = $2 AND level = $3")
        .bind(me.id)
        .bind(req.cycle as i32)
        .bind(req.level as i32)
        .fetch_optional(&mut *tx)
        .await?;
    let Some((options, done)) = row else { return bad("Nie ma takiej nagrody do wybrania") };
    if done != 0 {
        return bad("Ta nagroda jest już odebrana");
    }
    let options: Vec<Value> = serde_json::from_str(&options).unwrap_or_default();
    let chosen: Vec<Value> = picks.iter().filter_map(|i| options.get(*i as usize)).map(|o| o["reward"].clone()).collect();
    if chosen.len() != CHOICE_PICKS {
        return bad("Nagroda jest uszkodzona - napisz do admina");
    }
    let usable: Vec<Value> = chosen.iter().filter(|r| exp::usable(&cx.cat, r)).cloned().collect();
    crate::achievements::grant_rewards(&mut tx, &cx, &usable, "level").await?;
    sqlx::query("UPDATE level_choices SET done = 1, picked = $4 WHERE user_id = $1 AND cycle = $2 AND level = $3")
        .bind(me.id)
        .bind(req.cycle as i32)
        .bind(req.level as i32)
        .bind(json!(picks).to_string())
        .execute(&mut *tx)
        .await?;
    let state = get_state(&mut tx, me.id).await?;
    let chests = get_chests(&mut tx, &cx.cat, me.id).await?;
    let mine = exp::me_view(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "rewards": views(&cx.cat, &usable), "state": state, "chests": chests, "me": mine}))
}

/// Sam postęp (lekkie zapytanie po zdarzeniu, które dało EXP; bez oznaczania leveli jako obejrzanych)
pub async fn exp_progress(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    ok(exp::me_view(&mut c, me.id).await?)
}

/// Okienka „Nowy level”: levele, których gracz jeszcze nie widział (każdy raz), z nagrodami; zwraca też świeży postęp
pub async fn exp_pop(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let cfg = exp::config();
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let rows: Vec<(i32, i16)> = sqlx::query_as("SELECT level, paid FROM level_claims WHERE user_id = $1 AND seen = 0 ORDER BY cycle, level")
        .bind(me.id)
        .fetch_all(&mut *tx)
        .await?;
    if !rows.is_empty() {
        sqlx::query("UPDATE level_claims SET seen = 1 WHERE user_id = $1 AND seen = 0").bind(me.id).execute(&mut *tx).await?;
    }
    let mine = exp::me_view(&mut tx, me.id).await?;
    tx.commit().await?;
    let list: Vec<Value> = rows
        .iter()
        .map(|(l, paid)| {
            let l = i64::from(*l);
            let r = cfg.rewards_for(l);
            json!({
                "level": l, "paid": *paid != 0, "badge": l >= MAX_LEVEL, "choice": cfg.choice_levels.contains(&l),
                "small": if *paid != 0 { views(&cat, &r.small) } else { vec![] },
                "special": if *paid != 0 { views(&cat, &r.special) } else { vec![] },
            })
        })
        .collect();
    ok(json!({"list": list, "me": mine}))
}

// ---------------------------------------------------------------- panel admina

pub async fn admin_exp(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let cat = st.cat();
    let cfg = exp::config();
    let (variants, cards, chests) = reward_options(&cat);
    let mut c = st.db.acquire().await?;
    let exps: Vec<i64> = sqlx::query_scalar("SELECT exp FROM user_exp").fetch_all(&mut *c).await?;
    let players: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id > 0").fetch_one(&mut *c).await?;
    let badges: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM exp_badges").fetch_one(&mut *c).await?;
    let mut dist = vec![0_i64; MAX_LEVEL as usize + 1];
    for e in &exps {
        dist[cfg.level_for(*e) as usize] += 1;
    }
    dist[1] += (players - exps.len() as i64).max(0);
    let sources: Vec<Value> = SOURCES
        .iter()
        .map(|s| {
            let (e, cap) = cfg.sources.get(s.key).copied().unwrap_or((s.exp, s.cap));
            json!({"key": s.key, "group": s.group, "name": s.name, "exp": e, "cap": cap, "defExp": s.exp, "defCap": s.cap})
        })
        .collect();
    let levels: Vec<Value> = (1..=MAX_LEVEL)
        .map(|l| {
            let r = cfg.rewards_for(l);
            let d = default_rewards(l);
            json!({
                "level": l,
                "need": if l < MAX_LEVEL { cfg.need(l) } else { 0 },
                "curveNeed": if l < MAX_LEVEL { cfg.curve.need(l) } else { 0 },
                "total": cfg.total_for(l),
                "small": r.small, "special": r.special,
                "defaultSmall": d.small, "defaultSpecial": d.special,
                "players": dist[l as usize],
                "choice": cfg.choice_levels.contains(&l),
            })
        })
        .collect();
    ok(json!({
        "mult": cfg.mult, "backfillPct": cfg.backfill_pct,
        "curve": {"base": cfg.curve.base, "scale": cfg.curve.scale, "power": cfg.curve.power},
        "defaultCurve": {"base": DEFAULT_CURVE.base, "scale": DEFAULT_CURVE.scale, "power": DEFAULT_CURVE.power},
        "sources": sources, "levels": levels, "players": players, "withExp": exps.len(), "badges": badges,
        "maxLevel": MAX_LEVEL, "backfillMaxLevel": exp::BACKFILL_MAX_LEVEL,
        "decay": cfg.decay, "defaultDecay": DEFAULT_DECAY, "exclusiveChance": cfg.exclusive_chance,
        "exclusiveCards": cfg.excl_cards.iter().map(|(p, v)| json!({"person": p, "variant": v})).collect::<Vec<_>>(),
        "exclusiveChests": cfg.excl_chests, "badgeTiers": BADGE_TIERS,
        "variants": variants, "cards": cards, "chests": chests,
    }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ExpSave {
    mult: Value,
    #[serde(rename = "backfillPct")]
    backfill_pct: Value,
    curve: Value,
    needs: Value,
    sources: Value,
    rewards: Value,
    decay: Value,
    #[serde(rename = "choiceLevels")]
    choice_levels: Value,
    #[serde(rename = "exclusiveChance")]
    exclusive_chance: Value,
    #[serde(rename = "exclusiveCards")]
    exclusive_cards: Value,
    #[serde(rename = "exclusiveChests")]
    exclusive_chests: Value,
    /// true = wróć do ustawień domyślnych
    reset: bool,
}

pub async fn admin_exp_save(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<ExpSave>) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    let (cfg, details) = if req.reset {
        exp::reset(&mut tx).await?;
        (ExpConfig::default(), "domyślne ustawienia EXP i leveli".to_owned())
    } else {
        let raw = json!({"mult": req.mult, "backfillPct": req.backfill_pct, "curve": req.curve, "needs": req.needs, "sources": req.sources,
                         "decay": req.decay, "choiceLevels": req.choice_levels, "exclusiveChance": req.exclusive_chance,
                         "exclusiveCards": req.exclusive_cards, "exclusiveChests": req.exclusive_chests});
        let cfg = clean_config(&raw, Some(&req.rewards), &cat);
        exp::save(&mut tx, &cfg).await?;
        let d = format!(
            "mnożnik {}, spadek {}, krzywa {}+{}·L^{} (level 100 = {} EXP), własne poziomy: {}, zmienione nagrody: {}, duże nagrody na {} levelach, pula ekskluzywna: {} kart, {} skrzynek",
            cfg.mult, cfg.decay, cfg.curve.base, cfg.curve.scale, cfg.curve.power, cfg.total_for(MAX_LEVEL), cfg.needs.len(), cfg.rewards.len(),
            cfg.choice_levels.len(), cfg.excl_cards.len(), cfg.excl_chests.len()
        );
        (cfg, d)
    };
    log_admin(&mut tx, &me, "exp_save", None, &details).await?;
    tx.commit().await?;
    exp::set_config(cfg);
    ok(json!({"ok": true}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct GrantRequest {
    username: String,
    /// "add" (dodaj / odejmij EXP), "set_exp" (ustaw EXP), "set_level" (ustaw level, bez nagród za przeskoczone)
    mode: String,
    value: i64,
}

/// Ręczne nadanie EXP / ustawienie levelu gracza (dziennik admina `exp_grant`)
pub async fn admin_exp_grant(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<GrantRequest>) -> Res {
    if !["add", "set_exp", "set_level"].contains(&req.mode.as_str()) {
        return bad("Wybierz, co zrobić z EXP");
    }
    if req.value.abs() > 1_000_000_000 {
        return bad("Za duża wartość");
    }
    if req.mode == "set_level" && !(1..MAX_LEVEL).contains(&req.value) {
        return bad(format!("Level można ustawić od 1 do {}. Level {MAX_LEVEL} gracz osiąga sam (odznaka i reset) - dodaj mu EXP", MAX_LEVEL - 1));
    }
    let mut tx = st.db.begin().await?;
    let uid: Option<i64> = sqlx::query_scalar("SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id > 0")
        .bind(req.username.trim())
        .fetch_optional(&mut *tx)
        .await?;
    let Some(uid) = uid else { return bad("Nie ma takiego gracza") };
    let (exp_now, level) = exp::admin_change(&mut tx, uid, &req.mode, req.value).await?;
    let what = match req.mode.as_str() {
        "add" => format!("{:+} EXP", req.value),
        "set_exp" => format!("EXP = {}", req.value),
        _ => format!("level = {}", req.value),
    };
    log_admin(&mut tx, &me, "exp_grant", Some(uid), &format!("{what} (teraz {exp_now} EXP, level {level})")).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "exp": exp_now, "level": level, "paysRewards": req.mode != "set_level"}))
}
