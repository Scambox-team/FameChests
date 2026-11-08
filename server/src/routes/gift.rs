//! Prezentowy (wariant `gift`): karta przychodzi zapakowana - właściciel sam ją odpakowuje (animacja w przeglądarce,
//! `fx/effects.ts`), a w podglądzie może ją zapakować ponownie. Odpakowanie jest zapisane przy egzemplarzu
//! (`card_unwrapped.item_id`), więc idzie za kartą przy każdym przekazaniu i znika razem z nią.

use axum::extract::{Path, State};
use serde_json::json;

use super::ok;
use crate::achievements::parts;
use crate::auth::Me;
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, Res};
use crate::state::AppState;

pub const VARIANT: &str = "gift";

/// Karta w tym wariancie (także połączenie, np. flag+gift)
pub fn is_gift(variant: &str) -> bool {
    parts(variant).contains(&VARIANT)
}

/// Sprawdza, że egzemplarz jest mój i jest Prezentowy
async fn my_gift(c: &mut Conn, uid: i64, id: i64) -> Result<bool, sqlx::Error> {
    let variant: Option<String> = sqlx::query_scalar("SELECT variant FROM items WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(uid)
        .fetch_optional(c)
        .await?;
    Ok(variant.as_deref().is_some_and(is_gift))
}

pub async fn unwrap_item(State(st): State<AppState>, Me(me): Me, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if !my_gift(&mut tx, me.id, id).await? {
        return bad("To nie jest twój Prezent");
    }
    sqlx::query("INSERT INTO card_unwrapped (item_id, at) VALUES ($1, $2) ON CONFLICT (item_id) DO NOTHING")
        .bind(id)
        .bind(now())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn rewrap_item(State(st): State<AppState>, Me(me): Me, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if !my_gift(&mut tx, me.id, id).await? {
        return bad("To nie jest twój Prezent");
    }
    sqlx::query("DELETE FROM card_unwrapped WHERE item_id = $1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

/// Odpakowane egzemplarze gracza
pub async fn unwrapped_items(c: &mut Conn, uid: i64) -> sqlx::Result<Vec<i64>> {
    sqlx::query_scalar("SELECT u.item_id FROM card_unwrapped u JOIN items i ON i.id = u.item_id WHERE i.user_id = $1")
        .bind(uid)
        .fetch_all(c)
        .await
}
