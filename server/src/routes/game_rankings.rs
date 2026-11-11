//! Rankingi gier z zakładki Gry: szachy (wygrane z ludźmi), pinball (najlepszy sprawdzony wynik na każdym poziomie) i strzelnica.
//! Bez graczy zablokowanych, ukrytych przez admina i z pieniędzmi od admina (jak ranking główny). W pinballu liczą się tylko
//! gry odtworzone przez serwer (`pinball_runs.verified`), więc wyniku nie da się wpisać z przeglądarki.

use axum::extract::{Query, State};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

use super::ok;
use crate::auth::Me;
use crate::data::g;
use crate::error::{bad, Res};
use crate::pinball_sim;
use crate::state::AppState;

/// Ile miejsc pokazuje lista
const TOP: usize = 15;
pub(super) const NOT_HIDDEN: &str = "u.banned = 0 AND u.ranking_hidden = 0 AND u.money_generated = 0";

#[derive(Deserialize)]
pub struct RankQuery {
    game: String,
    level: Option<usize>,
}

/// Ranking wybranej gry: `?game=chess` albo `?game=pinball&level=2`
pub async fn game_ranking(State(st): State<AppState>, Me(me): Me, Query(q): Query<RankQuery>) -> Res {
    let mut c = st.db.acquire().await?;
    match q.game.as_str() {
        "chess" => {
            // wygrane w partiach z ludźmi (bez treningu z botem i partii testowych); krótkie partie nie liczą się tak samo jak w nagrodach
            let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
                "SELECT u.id, u.username, COUNT(*) AS games, COUNT(*) FILTER (WHERE x.winner_id = p.uid) AS wins,
                        COUNT(*) FILTER (WHERE x.winner_id IS NOT NULL AND x.winner_id <> p.uid) AS losses
                 FROM chess_games x CROSS JOIN LATERAL (VALUES (x.white_id), (x.black_id)) AS p(uid)
                 JOIN users u ON u.id = p.uid
                 WHERE x.status = 'finished' AND x.bot = 0 AND x.white_id IS NOT NULL AND x.black_id IS NOT NULL
                   AND cardinality(string_to_array(btrim(x.moves), ' ')) >= $1 AND {NOT_HIDDEN}
                 GROUP BY u.id, u.username ORDER BY wins DESC, games ASC, u.username ASC"
            )))
            .bind(g().chess.min_plies as i64)
            .fetch_all(&mut *c)
            .await?;
            let all: Vec<_> = rows
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    let (games, wins, losses): (i64, i64, i64) = (r.get("games"), r.get("wins"), r.get("losses"));
                    json!({"place": i + 1, "user": r.get::<String, _>("username"), "me": r.get::<i64, _>("id") == me.id,
                           "wins": wins, "games": games, "losses": losses, "draws": games - wins - losses})
                })
                .collect();
            ok(json!({"game": "chess", "rows": top_and_me(&all)}))
        }
        "pinball" => {
            let level = q.level.unwrap_or(1);
            if level == 0 || level > pinball_sim::level_count() {
                return bad("Nie ma takiego poziomu");
            }
            let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
                "SELECT u.id, u.username, MAX(r.score) AS best, COUNT(*) AS games
                 FROM pinball_runs r JOIN users u ON u.id = r.user_id
                 WHERE r.verified = 1 AND r.finished_at > 0 AND r.level = $1 AND {NOT_HIDDEN}
                 GROUP BY u.id, u.username ORDER BY best DESC, MIN(r.finished_at) ASC"
            )))
            .bind(level as i32)
            .fetch_all(&mut *c)
            .await?;
            let all: Vec<_> = rows
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    json!({"place": i + 1, "user": r.get::<String, _>("username"), "me": r.get::<i64, _>("id") == me.id,
                           "best": r.get::<i64, _>("best"), "games": r.get::<i64, _>("games")})
                })
                .collect();
            ok(json!({"game": "pinball", "level": level, "rows": top_and_me(&all)}))
        }
        "aim" => {
            let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
                "SELECT u.id, u.username, MAX(r.score) AS best, COUNT(*) AS games
                 FROM aim_runs r JOIN users u ON u.id = r.user_id
                 WHERE r.verified = 1 AND r.finished_at > 0 AND {NOT_HIDDEN}
                 GROUP BY u.id, u.username ORDER BY best DESC, MIN(r.finished_at) ASC"
            )))
            .fetch_all(&mut *c)
            .await?;
            let all: Vec<_> = rows
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    json!({"place": i + 1, "user": r.get::<String, _>("username"), "me": r.get::<i64, _>("id") == me.id,
                           "best": r.get::<i64, _>("best"), "games": r.get::<i64, _>("games")})
                })
                .collect();
            ok(json!({"game": "aim", "rows": top_and_me(&all)}))
        }
        _ => bad("Nie ma rankingu tej gry"),
    }
}

/// Pierwsze `TOP` miejsc, a gdy gracz jest dalej - jego wiersz na końcu (z prawdziwym miejscem)
fn top_and_me(all: &[serde_json::Value]) -> Vec<serde_json::Value> {
    let mut out: Vec<_> = all.iter().take(TOP).cloned().collect();
    if let Some(mine) = all.iter().skip(TOP).find(|r| r["me"] == true) {
        out.push(mine.clone());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn my_row_is_appended_when_outside_the_top() {
        let all: Vec<_> = (1..=40).map(|i| json!({"place": i, "me": i == 30})).collect();
        let out = top_and_me(&all);
        assert_eq!(out.len(), TOP + 1);
        assert_eq!(out.last().unwrap()["place"], 30);
        // w pierwszej piętnastce nie dublujemy
        let all: Vec<_> = (1..=40).map(|i| json!({"place": i, "me": i == 3})).collect();
        assert_eq!(top_and_me(&all).len(), TOP);
    }
}
