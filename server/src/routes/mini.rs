//! Miniprofil gracza (okienko po najechaniu na jego nazwę w dowolnym miejscu gry) i ekwipunek znajomego.
//!
//! - `GET /api/users/<nazwa>/mini` - nazwa, ikona, level i odznaka służby, rola, online, kilka statystyk, relacja (do szybkich akcji), tło miniprofilu
//!   i obramówka (kosmetyki profilu). Gracze poza rankingiem (zablokowani, ukryci, z pieniędzmi od admina) są dla innych nieznani (404), jak na profilu.
//! - `GET /api/users/<nazwa>/inventory` - cały ekwipunek (karty grupami osoba + wariant z liczbą), tylko dla znajomych i tylko gdy gracz tego nie
//!   zablokował w ustawieniach (domyślnie znajomi widzą; `cosmetics::inventory_allowed`). Z niego przeglądarka proponuje wymianę albo kupno
//!   (zlecenie „Szukam” skierowane do tego znajomego - `market_wanted.target_id`).

use std::collections::HashSet;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use indexmap::IndexMap;
use serde_json::json;

use super::ok;
use crate::auth::{find_user, Me};
use crate::cosmetics::{self, inventory_allowed};
use crate::error::{fail, Res};
use crate::game::views::reveal;
use crate::game::{discovered, relation, Relation};
use crate::state::AppState;

fn unknown<T>() -> Res<T> {
    fail(StatusCode::NOT_FOUND, "Nie ma takiego gracza")
}

pub async fn user_mini(State(st): State<AppState>, Me(me): Me, Path(name): Path<String>) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let Some(u) = find_user(&mut c, &name).await? else { return unknown() };
    if u.hidden_from_ranking() && u.id != me.id && !me.admin() {
        return unknown();
    }
    let rel = relation(&mut c, me.id, u.id).await?;
    let style = cosmetics::style_of(&mut c, u.id).await?;
    // statystyki tylko tego jednego gracza (kolekcja = jego karty teraz, nie wszystkich graczy)
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT person_id, variant FROM items WHERE user_id = $1").bind(u.id).fetch_all(&mut *c).await?;
    let (mut value, mut total) = (0i64, 0i64);
    let mut unique: HashSet<&str> = HashSet::new();
    for (pid, variant) in &rows {
        if let Some(p) = cat.person(pid) {
            value += p.value(variant);
            unique.insert(pid.as_str());
            total += 1;
        }
    }
    let opened: i64 =
        sqlx::query_scalar("SELECT value FROM user_state WHERE user_id = $1 AND key = 'opened'").bind(u.id).fetch_optional(&mut *c).await?.unwrap_or(0);
    let (level, badge) = crate::exp::levels_of(&mut c, &[u.id]).await?.get(&u.id).cloned().unwrap_or((1, None));
    ok(json!({
        "user": u.view(&cat),
        "created": u.created_at,
        "relation": rel,
        "level": level,
        "badge": badge,
        "role": if u.admin() { "admin" } else { "" },
        "online": st.online.is_online(u.id),
        "stats": {"value": value, "unique": unique.len(), "total": total, "opened": opened},
        "style": style.shown(),
        "bio": style.bio,
        "country": style.country,
        // czy mogę zajrzeć do jego ekwipunku (przycisk „Ekwipunek”)
        "inventory": inventory_allowed(style.inventory, rel, u.hidden_from_ranking()),
        // handel tylko między znajomymi spoza „poza rankingiem” (jak w wymianach)
        "canTrade": rel == Relation::Friend && !me.hidden_from_ranking() && !u.hidden_from_ranking(),
    }))
}

pub async fn user_inventory(State(st): State<AppState>, Me(me): Me, Path(name): Path<String>) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let Some(u) = find_user(&mut c, &name).await? else { return unknown() };
    if u.hidden_from_ranking() && u.id != me.id {
        return unknown();
    }
    let rel = relation(&mut c, me.id, u.id).await?;
    let style = cosmetics::style_of(&mut c, u.id).await?;
    if !inventory_allowed(style.inventory, rel, u.hidden_from_ranking()) {
        let why = match rel {
            Relation::Friend => format!("{} ukrył(a) swój ekwipunek", u.username),
            _ => "Ekwipunek mogą oglądać tylko znajomi".to_owned(),
        };
        return fail(StatusCode::FORBIDDEN, why);
    }
    let rows: Vec<(String, String, i64)> = sqlx::query_as("SELECT person_id, variant, COUNT(*) FROM items WHERE user_id = $1 GROUP BY person_id, variant")
        .bind(u.id)
        .fetch_all(&mut *c)
        .await?;
    let collection: Vec<_> =
        rows.into_iter().filter(|(p, _, _)| cat.has(p)).map(|(person, variant, count)| json!({"person": person, "variant": variant, "count": count})).collect();
    // tajne karty znajomego widać w jego ekwipunku, nawet jeśli samemu się ich jeszcze nie odkryło
    let mut revealed = IndexMap::new();
    if rel == Relation::Friend {
        let found = discovered(&mut c, me.id).await?;
        let pids: HashSet<String> = collection.iter().filter_map(|c| c["person"].as_str().map(str::to_owned)).collect();
        for pid in pids {
            if let Some(v) = reveal(&st.images, &cat, &cat.people[&pid], &found) {
                revealed.insert(pid, v);
            }
        }
    }
    ok(json!({"username": u.username, "relation": rel, "collection": collection, "reveal": revealed, "canTrade": rel == Relation::Friend}))
}
