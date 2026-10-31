//! Zdrapka (wariant `scratch`): właściciel zdrapuje srebrną folię ze zdjęcia monetą (przeglądarka, `static/js/scratch.js`).
//! Zdrapana do końca karta zostaje odkryta na stałe - zapis przy egzemplarzu (`card_scratched.item_id`), więc idzie za
//! kartą przy każdym przekazaniu i znika razem z nią. Częściowe zdrapanie nie jest zapisywane.

use axum::extract::{Path, State};
use serde_json::json;

use super::ok;
use crate::achievements::parts;
use crate::auth::Me;
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, Res};
use crate::state::AppState;

pub const VARIANT: &str = "scratch";

/// Karta w tym wariancie (także połączenie, np. flag+scratch)
pub fn is_scratch(variant: &str) -> bool {
    parts(variant).contains(&VARIANT)
}

pub async fn scratch_item(State(st): State<AppState>, Me(me): Me, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let variant: Option<String> = sqlx::query_scalar("SELECT variant FROM items WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(me.id)
        .fetch_optional(&mut *tx)
        .await?;
    if !variant.as_deref().is_some_and(is_scratch) {
        return bad("To nie jest twoja Zdrapka");
    }
    sqlx::query("INSERT INTO card_scratched (item_id, at) VALUES ($1, $2) ON CONFLICT (item_id) DO NOTHING")
        .bind(id)
        .bind(now())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

/// Zdrapane egzemplarze gracza
pub async fn scratched_items(c: &mut Conn, uid: i64) -> sqlx::Result<Vec<i64>> {
    sqlx::query_scalar("SELECT s.item_id FROM card_scratched s JOIN items i ON i.id = s.item_id WHERE i.user_id = $1")
        .bind(uid)
        .fetch_all(c)
        .await
}
