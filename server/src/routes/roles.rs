//! Rangi adminów. Właściciel (OWNER_IDS) ma wszystko i tylko on tworzy rangi oraz je nadaje.
//! Ranga to nazwa + lista uprawnień (`PERMS`). Admin bez rangi (stare konta) ma wszystkie uprawnienia poza
//! właścicielskimi, jak dotąd. Uprawnienie sprawdza jedno miejsce - `gate` (warstwa na całym routerze),
//! które dla ścieżki `/api/admin/...` wybiera wymagane uprawnienie (`need`); nieopisana ścieżka = tylko właściciel.

use std::collections::HashSet;

use axum::extract::{FromRequestParts, Path, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

use super::{ok, JsonBody};
use crate::auth::{Admin, AuthReject, Owner, User};
use crate::error::{bad, fail, Res};
use crate::game::log_admin;
use crate::state::AppState;

/// (klucz, opis w panelu)
pub const PERMS: &[(&str, &str)] = &[
    ("catalog", "Katalog: skrzynki, karty, import i eksport, warianty, naklejki"),
    ("content", "Treści: wiadomości, maile, osiągnięcia, questy, eventy, polecenia, linki, easter egg, radio"),
    ("games", "Gry: kasyno, szachy, wyścigi konne, CTF, snake"),
    ("reports", "Zgłoszenia od graczy"),
    ("log", "Dziennik adminów"),
    ("users", "Gracze: lista, blokady, ranking, podgląd kart i dostępu"),
    ("economy", "Gracze: pieniądze, skrzynki, usuwanie kart"),
    ("accounts", "Konta: reset hasła, zmiana emaila, usuwanie kont"),
];

pub enum Need {
    /// każdy admin
    Any,
    Perm(&'static str),
    Owner,
}

/// Czego wymaga dana ścieżka. Poza `/api/admin/` (arena, narzędzia testowe) - każdy admin.
pub fn need(path: &str) -> Need {
    let Some(rest) = path.strip_prefix("/api/admin/") else { return Need::Any };
    let seg: Vec<&str> = rest.trim_end_matches('/').split('/').collect();
    match seg[0] {
        "role" | "catalog" => Need::Any,
        "roles" | "backups" => Need::Owner,
        "log" => Need::Perm("log"),
        "reports" => Need::Perm("reports"),
        "crates" | "shop-size" | "cards" | "variants" | "variant-designs" | "stickers" => Need::Perm("catalog"),
        "messages" | "links" | "email-templates" | "achievements" | "quests" | "referrals" | "events" | "egg" | "ufo" | "radio" | "themes" | "passport" => {
            Need::Perm("content")
        }
        "horses" | "chess-skins" | "ctf" | "snake" => Need::Perm("games"),
        // /users, /users/{id}, /users/{id}/<akcja>[/...]
        "users" => match (seg.len(), seg.get(2).copied()) {
            (1, _) => Need::Perm("users"),
            (2, _) => Need::Perm("accounts"),
            (_, Some("ban" | "ranking" | "access")) => Need::Perm("users"),
            (_, Some("cards")) if seg.len() == 3 => Need::Perm("users"),
            (_, Some("cards" | "chests" | "money")) => Need::Perm("economy"),
            (_, Some("reset-link" | "email")) => Need::Perm("accounts"),
            _ => Need::Owner, // m.in. /admin (daj/odbierz admina) i /role (ranga)
        },
        _ => Need::Owner,
    }
}

/// Uprawnienia zalogowanego admina
pub struct Staff {
    pub owner: bool,
    pub role: Option<(i64, String)>,
    perms: HashSet<String>,
}

impl Staff {
    pub fn can(&self, perm: &str) -> bool {
        self.owner || self.role.is_none() || self.perms.contains(perm)
    }

    pub fn perm_list(&self) -> Vec<&'static str> {
        PERMS.iter().map(|p| p.0).filter(|p| self.can(p)).collect()
    }
}

fn parse_perms(s: &str) -> HashSet<String> {
    s.split(',').map(str::trim).filter(|p| PERMS.iter().any(|k| k.0 == *p)).map(str::to_owned).collect()
}

pub async fn staff_of(st: &AppState, u: &User) -> sqlx::Result<Staff> {
    let row = sqlx::query(
        "SELECT r.id, r.name, r.perms FROM admin_staff s JOIN admin_roles r ON r.id = s.role_id WHERE s.user_id = $1",
    )
    .bind(u.id)
    .fetch_optional(&st.db)
    .await?;
    let (role, perms) = match row {
        Some(r) => (Some((r.get::<i64, _>("id"), r.get::<String, _>("name"))), parse_perms(&r.get::<String, _>("perms"))),
        None => (None, HashSet::new()),
    };
    Ok(Staff { owner: st.cfg.is_owner(u.id), role, perms })
}

/// Warstwa na całym routerze: sprawdza uprawnienie rangi przed wywołaniem handlera
pub async fn gate(State(st): State<AppState>, req: Request, next: Next) -> Response {
    let need = need(req.uri().path());
    if matches!(need, Need::Any) {
        return next.run(req).await;
    }
    let (mut parts, body) = req.into_parts();
    let u = match Admin::from_request_parts(&mut parts, &st).await {
        Ok(Admin(u)) => u,
        Err(e) => return e.into_response(),
    };
    match need {
        Need::Owner if !st.cfg.is_owner(u.id) => return AuthReject::OwnerOnly.into_response(),
        Need::Perm(p) => match staff_of(&st, &u).await {
            Ok(s) if s.can(p) => {}
            Ok(_) => {
                let what = PERMS.iter().find(|k| k.0 == p).map_or(p, |k| k.1);
                return (StatusCode::FORBIDDEN, axum::Json(json!({"error": format!("Twoja ranga nie ma uprawnienia: {what}")})))
                    .into_response();
            }
            Err(_) => return AuthReject::Internal.into_response(),
        },
        _ => {}
    }
    next.run(Request::from_parts(parts, body)).await
}

/// Ranga zalogowanego admina - panel chowa działy, do których nie ma uprawnień
pub async fn admin_role(State(st): State<AppState>, Admin(me): Admin) -> Res {
    let s = staff_of(&st, &me).await?;
    ok(json!({
        "id": me.id,
        "owner": s.owner,
        "role": s.role.as_ref().map(|r| r.1.clone()),
        "perms": s.perm_list(),
    }))
}

/// Rangi, ich uprawnienia i admini z przypisaną rangą (strona „Rangi”)
pub async fn roles_list(State(st): State<AppState>, Owner(_): Owner) -> Res {
    let roles: Vec<_> = sqlx::query("SELECT id, name, perms FROM admin_roles ORDER BY id")
        .fetch_all(&st.db)
        .await?
        .into_iter()
        .map(|r| {
            let mut perms: Vec<String> = parse_perms(&r.get::<String, _>("perms")).into_iter().collect();
            perms.sort();
            json!({"id": r.get::<i64, _>("id"), "name": r.get::<String, _>("name"), "perms": perms})
        })
        .collect();
    let admins: Vec<_> = sqlx::query(
        "SELECT u.id, u.username, s.role_id FROM users u LEFT JOIN admin_staff s ON s.user_id = u.id \
         WHERE u.is_admin <> 0 ORDER BY u.id",
    )
    .fetch_all(&st.db)
    .await?
    .into_iter()
    .map(|r| {
        let id: i64 = r.get("id");
        json!({"id": id, "username": r.get::<String, _>("username"), "owner": st.cfg.is_owner(id), "roleId": r.get::<Option<i64>, _>("role_id")})
    })
    .collect();
    let perms: Vec<_> = PERMS.iter().map(|(k, d)| json!({"key": k, "label": d})).collect();
    ok(json!({"roles": roles, "admins": admins, "perms": perms}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct RoleRequest {
    id: Option<i64>,
    name: String,
    perms: Vec<String>,
}

/// Nowa ranga (bez `id`) albo zmiana istniejącej
pub async fn role_save(State(st): State<AppState>, Owner(me): Owner, JsonBody(req): JsonBody<RoleRequest>) -> Res {
    let name = req.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.chars().count() > 30 {
        return bad("Nazwa rangi: od 1 do 30 znaków");
    }
    if let Some(p) = req.perms.iter().find(|p| !PERMS.iter().any(|k| k.0 == p.as_str())) {
        return bad(format!("Nieznane uprawnienie: {p}"));
    }
    let perms = PERMS.iter().map(|p| p.0).filter(|k| req.perms.iter().any(|p| p == k)).collect::<Vec<_>>().join(",");
    let mut tx = st.db.begin().await?;
    let taken = sqlx::query_scalar::<_, i64>("SELECT id FROM admin_roles WHERE LOWER(name) = LOWER($1)")
        .bind(&name)
        .fetch_optional(&mut *tx)
        .await?;
    if taken.is_some_and(|t| Some(t) != req.id) {
        return bad("Ranga o takiej nazwie już istnieje");
    }
    match req.id {
        Some(id) => {
            let n = sqlx::query("UPDATE admin_roles SET name = $1, perms = $2 WHERE id = $3")
                .bind(&name)
                .bind(&perms)
                .bind(id)
                .execute(&mut *tx)
                .await?
                .rows_affected();
            if n == 0 {
                return fail(StatusCode::NOT_FOUND, "Nie ma takiej rangi");
            }
        }
        None => {
            sqlx::query("INSERT INTO admin_roles (name, perms) VALUES ($1, $2)").bind(&name).bind(&perms).execute(&mut *tx).await?;
        }
    }
    log_admin(&mut tx, &me, "role_save", None, &format!("{name}: {perms}")).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

/// Usunięcie rangi - tylko takiej, której nikt nie ma (inaczej jej admin dostałby wszystkie uprawnienia)
pub async fn role_delete(State(st): State<AppState>, Owner(me): Owner, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    let used: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_staff WHERE role_id = $1").bind(id).fetch_one(&mut *tx).await?;
    if used > 0 {
        return fail(StatusCode::CONFLICT, "Ktoś ma tę rangę - najpierw zmień mu rangę");
    }
    let name: Option<String> = sqlx::query_scalar("DELETE FROM admin_roles WHERE id = $1 RETURNING name").bind(id).fetch_optional(&mut *tx).await?;
    let Some(name) = name else { return fail(StatusCode::NOT_FOUND, "Nie ma takiej rangi") };
    log_admin(&mut tx, &me, "role_delete", None, &name).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AssignRequest {
    user_id: i64,
    /// None = bez rangi (wszystkie uprawnienia poza właścicielskimi)
    role_id: Option<i64>,
}

/// Nadanie rangi adminowi
pub async fn role_assign(State(st): State<AppState>, Owner(me): Owner, JsonBody(req): JsonBody<AssignRequest>) -> Res {
    if st.cfg.is_owner(req.user_id) {
        return bad("Właściciel ma wszystkie uprawnienia - rangi go nie dotyczą");
    }
    let mut tx = st.db.begin().await?;
    let is_admin: Option<i32> = sqlx::query_scalar("SELECT is_admin FROM users WHERE id = $1").bind(req.user_id).fetch_optional(&mut *tx).await?;
    if is_admin.is_none_or(|a| a == 0) {
        return bad("Ranga jest tylko dla adminów - najpierw daj graczowi admina");
    }
    let label = match req.role_id {
        Some(rid) => {
            let name: Option<String> = sqlx::query_scalar("SELECT name FROM admin_roles WHERE id = $1").bind(rid).fetch_optional(&mut *tx).await?;
            let Some(name) = name else { return fail(StatusCode::NOT_FOUND, "Nie ma takiej rangi") };
            sqlx::query(
                "INSERT INTO admin_staff (user_id, role_id) VALUES ($1, $2) \
                 ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id",
            )
            .bind(req.user_id)
            .bind(rid)
            .execute(&mut *tx)
            .await?;
            name
        }
        None => {
            sqlx::query("DELETE FROM admin_staff WHERE user_id = $1").bind(req.user_id).execute(&mut *tx).await?;
            "bez rangi".to_owned()
        }
    };
    log_admin(&mut tx, &me, "role_assign", Some(req.user_id), &label).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

#[cfg(test)]
mod tests {
    use super::{need, Need};

    fn perm(p: &str) -> Option<&'static str> {
        match need(p) {
            Need::Perm(k) => Some(k),
            _ => None,
        }
    }

    #[test]
    fn paths() {
        assert!(matches!(need("/api/arena/inbox"), Need::Any));
        assert!(matches!(need("/api/admin/role"), Need::Any));
        assert!(matches!(need("/api/admin/catalog"), Need::Any));
        assert!(matches!(need("/api/admin/roles"), Need::Owner));
        assert!(matches!(need("/api/admin/roles/3"), Need::Owner));
        assert!(matches!(need("/api/admin/nowe-cos"), Need::Owner), "nieopisana ścieżka = tylko właściciel");
        assert!(matches!(need("/api/admin/users/5/admin"), Need::Owner));
        assert_eq!(perm("/api/admin/crates/x/restore"), Some("catalog"));
        assert_eq!(perm("/api/admin/cards/export"), Some("catalog"));
        assert_eq!(perm("/api/admin/users"), Some("users"));
        assert_eq!(perm("/api/admin/users/5"), Some("accounts"));
        assert_eq!(perm("/api/admin/users/5/ban"), Some("users"));
        assert_eq!(perm("/api/admin/users/5/cards"), Some("users"));
        assert_eq!(perm("/api/admin/users/5/cards/delete"), Some("economy"));
        assert_eq!(perm("/api/admin/users/5/money"), Some("economy"));
        assert_eq!(perm("/api/admin/users/5/email"), Some("accounts"));
        assert_eq!(perm("/api/admin/users/5/reset-link"), Some("accounts"));
        assert_eq!(perm("/api/admin/referrals/mine"), Some("content"));
        assert_eq!(perm("/api/admin/ctf"), Some("games"));
        assert_eq!(perm("/api/admin/radio/upload"), Some("content"));
        assert_eq!(perm("/api/admin/themes"), Some("content"));
        assert_eq!(perm("/api/admin/radio/file/3"), Some("content"));
    }
}
