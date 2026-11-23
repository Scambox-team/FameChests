//! Mecz z perspektywy gracza: on = "me", rywal = "foe". Ręka rywala jest zakryta (tylko liczba kart).

use indexmap::IndexMap;
use serde::Serialize;
use serde_json::{json, Value};

use super::engine::{EndReason, Game, Log, Outcome, Side, Unit};
use super::{Battle, Hero, Reward};

fn label(me: Side, s: Side) -> &'static str {
    if s == me {
        "me"
    } else {
        "foe"
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleView<'a> {
    id: &'a str,
    mode: super::Mode,
    /// numer ostatniego wpisu dziennika
    seen: usize,
    /// nowe wpisy (od `since`)
    log: Vec<LogView<'a>>,
    active: &'static str,
    /// sekundy do końca meczu / tury
    game_left: f64,
    turn_left: f64,
    overtimes: i64,
    over: Option<&'static str>,
    reason: Option<EndReason>,
    rules: Value,
    sides: IndexMap<&'static str, Value>,
    heroes: IndexMap<&'static str, &'a Hero>,
    rewards: Option<&'a Reward>,
}

#[derive(Serialize)]
struct LogView<'a> {
    n: usize,
    side: Option<&'static str>,
    text: &'a str,
    fx: Vec<Value>,
}

fn unit_json(g: &Game, s: Side, me: Side, u: &Unit) -> Value {
    let mut fx = json!({
        "uid": u.uid, "pid": u.pid, "variant": u.variant, "hp": u.hp, "maxHp": u.max_hp, "row": u.row, "slot": u.slot,
        "atk": g.attack_of(s, u), "points": u.points, "acted": u.acted, "range": [u.stats.range_min, u.stats.range_max],
        "class": u.stats.class, "spec": u.stats.spec, "abilities": u.stats.abilities,
        "shield": u.shields.iter().map(|x| x.value).sum::<i64>(),
        "poison": u.poison.iter().map(|x| x.value).sum::<i64>(),
        "regen": u.regen.iter().map(|x| x.value).sum::<i64>(),
        "reviveIn": u.revive_in,
    });
    if s == me {
        // cele moich umiejętności (podświetlenie przy wyborze)
        let targets: Vec<Value> = u
            .stats
            .abilities
            .iter()
            .map(|ab| {
                let (side, list) = g.targets(s, u.uid, ab);
                json!({"side": label(me, side), "uids": list})
            })
            .collect();
        fx["targets"] = json!(targets);
    }
    fx
}

impl Battle {
    pub fn view(&self, me: Side, since: usize, now: f64) -> BattleView<'_> {
        let g = &self.game;
        let sides = Side::BOTH
            .iter()
            .map(|&s| {
                let t = g.team(s);
                let board: Vec<Value> = t.board.iter().map(|u| unit_json(g, s, me, u)).collect();
                let ko: Vec<Value> = t.ko.iter().map(|u| json!({"uid": u.uid, "pid": u.pid, "variant": u.variant, "reviveIn": u.revive_in})).collect();
                let hand: Value = if s == me {
                    json!(t.hand.iter().map(|u| unit_json(g, s, me, u)).collect::<Vec<_>>())
                } else {
                    json!(t.hand.len())
                };
                let combos: Vec<Value> = g
                    .active_combos(s)
                    .iter()
                    .map(|(c, members)| json!({"id": c.id, "name": c.name, "effects": c.effects, "members": members}))
                    .collect();
                (label(me, s), json!({"name": t.name, "money": t.money, "points": t.points, "moves": t.moves, "board": board, "hand": hand,
                                       "ko": ko, "combos": combos, "income": t.income}))
            })
            .collect();
        let heroes = Side::BOTH.iter().map(|&s| (label(me, s), &self.heroes[s.idx()])).collect();
        let over = g.over.map(|o| match o {
            Outcome::Won(s) => label(me, s),
            Outcome::Draw => "draw",
        });
        let end = g.finished_at.unwrap_or(now);
        BattleView {
            id: &self.id,
            mode: g.mode,
            seen: g.log.len(),
            log: g.log.iter().filter(|l| l.n > since).map(|l: &Log| log_view(l, me)).collect(),
            active: label(me, g.active),
            game_left: (g.game_ends - end).max(0.0),
            turn_left: if g.over.is_some() { 0.0 } else { (g.turn_ends - now).max(0.0) },
            overtimes: g.overtimes,
            over,
            reason: g.reason,
            rules: json!({"rows": g.cfg.rows, "rowSlots": g.cfg.row_slots, "moves": g.cfg.moves, "turnSecs": g.cfg.turn_secs,
                          "gameSecs": g.cfg.game_secs, "overtimeSecs": g.cfg.overtime_secs, "maxOvertimes": g.cfg.max_overtimes,
                          "maxMoney": g.cfg.max_money}),
            sides,
            heroes,
            rewards: self.rewards[me.idx()].as_ref(),
        }
    }
}

fn log_view(l: &Log, me: Side) -> LogView<'_> {
    let fx = l
        .fx
        .iter()
        .map(|f| {
            let mut v = serde_json::to_value(f).unwrap_or(Value::Null);
            if let Some(s) = v.get("side").and_then(Value::as_str) {
                let s = if s == "a" { Side::A } else { Side::B };
                v["side"] = json!(label(me, s));
            }
            v
        })
        .collect();
    LogView { n: l.n, side: l.side.map(|s| label(me, s)), text: &l.text, fx }
}
