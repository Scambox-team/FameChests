//! Panel admina „Maile”: edycja szablonów maili (treść i temat), przywracanie domyślnych, mail próbny.

use axum::extract::{Path, State};
use serde::Deserialize;
use serde_json::json;

use super::{ok, JsonBody};
use crate::auth::Admin;
use crate::error::{bad, AppError, Res};
use crate::game::log_admin;
use crate::mail_templates::{self as tpl, Def};
use crate::state::AppState;

fn find(name: &str) -> Res<&'static Def> {
    tpl::def(name).ok_or_else(|| AppError::with_status(axum::http::StatusCode::NOT_FOUND, "Nie ma takiego szablonu"))
}

pub async fn admin_email_templates(State(st): State<AppState>, Admin(me): Admin) -> Res {
    let mut c = st.db.acquire().await?;
    let mut list = Vec::new();
    for d in tpl::DEFS {
        if let Some((subject, html, is_default)) = tpl::load(&mut c, d.name).await? {
            list.push(tpl::view(d, &subject, &html, is_default, &site(&st), &me.username));
        }
    }
    ok(json!({"templates": list, "smtp": st.cfg.mailer.configured()}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct TemplateBody {
    subject: String,
    html: String,
}

pub async fn admin_email_template_save(
    State(st): State<AppState>,
    Admin(me): Admin,
    Path(name): Path<String>,
    JsonBody(body): JsonBody<TemplateBody>,
) -> Res {
    let d = find(&name)?;
    if let Err(msg) = tpl::validate(d, &body.subject, &body.html) {
        return bad(msg);
    }
    let mut tx = st.db.begin().await?;
    tpl::save(&mut tx, d.name, &body.subject, &body.html).await?;
    log_admin(&mut tx, &me, "email_template_save", None, d.name).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_email_template_reset(State(st): State<AppState>, Admin(me): Admin, Path(name): Path<String>) -> Res {
    let d = find(&name)?;
    let mut tx = st.db.begin().await?;
    tpl::reset(&mut tx, d.name).await?;
    log_admin(&mut tx, &me, "email_template_reset", None, d.name).await?;
    tx.commit().await?;
    ok(tpl::view(d, d.subject, d.html, true, &site(&st), &me.username))
}

/// Próbny mail z przykładowymi wartościami na email admina. Treść można podać z formularza (jeszcze niezapisaną).
pub async fn admin_email_template_test(
    State(st): State<AppState>,
    Admin(me): Admin,
    Path(name): Path<String>,
    JsonBody(body): JsonBody<TemplateBody>,
) -> Res {
    let d = find(&name)?;
    let mut c = st.db.acquire().await?;
    let Some(link) = super::account::auth_link(&mut c, me.id).await? else {
        return bad("Twoje konto nie ma emaila - dodaj go w Profilu, żeby dostać mail próbny");
    };
    let (subject, html) = if body.html.is_empty() {
        let (s, h, _) = tpl::load(&mut c, d.name).await?.ok_or_else(AppError::not_found)?;
        (s, h)
    } else {
        if let Err(msg) = tpl::validate(d, &body.subject, &body.html) {
            return bad(msg);
        }
        (body.subject.clone(), body.html.clone())
    };
    let samples = tpl::samples(d, &site(&st), &me.username);
    let vars = tpl::sample_refs(&samples);
    let subject = tpl::render(&subject, &vars);
    st.cfg.mailer.send(&link.email, &subject, &tpl::render(&html, &vars)).await.map_err(|e| {
        tracing::warn!("mail próbny nie wyszedł: {e}");
        super::account::unavailable()
    })?;
    ok(json!({"ok": true, "smtp": st.cfg.mailer.configured()}))
}

/// Adres gry w przykładowych linkach podglądu i maila próbnego (PUBLIC_URL, bez niego localhost)
fn site(st: &AppState) -> String {
    st.cfg.public_url.clone().unwrap_or_else(|| "http://localhost:8000".into())
}
