//! Jednorazowe tokeny z linków w mailach (reset hasła, zmiana emaila). W bazie tylko sha256 tokenu;
//! nowy token danego rodzaju unieważnia starsze tego gracza.

use sha2::{Digest, Sha256};

use crate::db::{now, Conn};

/// Ile sekund link jest ważny
pub const TOKEN_TTL: f64 = 3600.0;
/// Początek tokenu w linku (odróżnia go od tokenów Supabase Auth)
pub const PREFIX: &str = "sb1_";
pub const KIND_RESET: &str = "password_reset";
pub const KIND_EMAIL_CHANGE: &str = "email_change";
pub const KIND_VERIFY: &str = "email_verify";
/// Link potwierdzający email jest ważny dłużej (gracz może zajrzeć do poczty dopiero następnego dnia)
pub const VERIFY_TTL: f64 = 86400.0;

pub fn ttl(kind: &str) -> f64 {
    if kind == KIND_VERIFY {
        VERIFY_TTL
    } else {
        TOKEN_TTL
    }
}

pub fn ttl_minutes(kind: &str) -> i64 {
    (ttl(kind) / 60.0) as i64
}

pub fn hash_token(raw: &str) -> String {
    hex::encode(Sha256::digest(raw.as_bytes()))
}

fn new_raw() -> String {
    let bytes: [u8; 32] = rand::random();
    format!("{PREFIX}{}", hex::encode(bytes))
}

/// Nowy token (zwraca jawną postać do linku); starsze tego rodzaju przestają działać
pub async fn issue(c: &mut Conn, uid: i64, kind: &str) -> sqlx::Result<String> {
    let t = now();
    sqlx::query("UPDATE account_tokens SET used = TRUE WHERE user_id = $1 AND kind = $2 AND NOT used")
        .bind(uid)
        .bind(kind)
        .execute(&mut *c)
        .await?;
    sqlx::query("DELETE FROM account_tokens WHERE expires_at < $1").bind(t - 86400.0).execute(&mut *c).await?;
    let raw = new_raw();
    sqlx::query("INSERT INTO account_tokens (token_hash, user_id, kind, expires_at, used, created_at) VALUES ($1, $2, $3, $4, FALSE, $5)")
        .bind(hash_token(&raw))
        .bind(uid)
        .bind(kind)
        .bind(t + ttl(kind))
        .bind(t)
        .execute(c)
        .await?;
    Ok(raw)
}

/// Czy gracz dostał token tego rodzaju przed chwilą (ogranicza wysyłkę maili)
pub async fn issued_within(c: &mut Conn, uid: i64, kind: &str, secs: f64) -> sqlx::Result<bool> {
    let n = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM account_tokens WHERE user_id = $1 AND kind = $2 AND created_at > $3")
        .bind(uid)
        .bind(kind)
        .bind(now() - secs)
        .fetch_one(c)
        .await?;
    Ok(n > 0)
}

/// Zużywa token (atomowo): zwraca id gracza, jeśli token jest tego rodzaju, nieużyty i nieprzeterminowany
pub async fn consume(c: &mut Conn, raw: &str, kind: &str) -> sqlx::Result<Option<i64>> {
    if !raw.starts_with(PREFIX) || raw.len() > 200 {
        return Ok(None);
    }
    sqlx::query_scalar::<_, i64>(
        "UPDATE account_tokens SET used = TRUE WHERE token_hash = $1 AND kind = $2 AND NOT used AND expires_at > $3 RETURNING user_id",
    )
    .bind(hash_token(raw))
    .bind(kind)
    .bind(now())
    .fetch_optional(c)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_are_sha256_hex() {
        assert_eq!(hash_token("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn raw_tokens_are_prefixed_and_unique() {
        let (a, b) = (new_raw(), new_raw());
        assert!(a.starts_with("sb1_") && a.len() == 4 + 64);
        assert_ne!(a, b);
        assert_ne!(hash_token(&a), a);
    }
}
