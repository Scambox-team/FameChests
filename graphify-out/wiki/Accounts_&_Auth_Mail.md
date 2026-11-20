# Accounts & Auth Mail

> 110 nodes · cohesion 0.06

## Key Concepts

- **account.rs** (84 connections) — `server/src/routes/account.rs`
- **account_mail.rs** (52 connections) — `server/src/routes/account_mail.rs`
- **fail()** (49 connections) — `server/src/error.rs`
- **register()** (29 connections) — `server/src/routes/account.rs`
- **add_email()** (22 connections) — `server/src/routes/account.rs`
- **login()** (22 connections) — `server/src/routes/account.rs`
- **tokens.rs** (21 connections) — `server/src/tokens.rs`
- **user_by_id()** (19 connections) — `server/src/auth.rs`
- **auth_link()** (18 connections) — `server/src/routes/account.rs`
- **change_password()** (17 connections) — `server/src/routes/account.rs`
- **email_change_confirm()** (16 connections) — `server/src/routes/account_mail.rs`
- **email_change_request()** (16 connections) — `server/src/routes/account_mail.rs`
- **admin_reset_link()** (16 connections) — `server/src/routes/admin.rs`
- **unavailable()** (15 connections) — `server/src/routes/account.rs`
- **admin_set_email()** (15 connections) — `server/src/routes/admin.rs`
- **deliver_reset()** (13 connections) — `server/src/routes/account_mail.rs`
- **reset_with_token()** (13 connections) — `server/src/routes/account_mail.rs`
- **admin_attach_email()** (12 connections) — `server/src/routes/account.rs`
- **forgot()** (12 connections) — `server/src/routes/account.rs`
- **base_url()** (12 connections) — `server/src/routes/account_mail.rs`
- **verify_resend()** (12 connections) — `server/src/routes/account_mail.rs`
- **change_email()** (11 connections) — `server/src/routes/account_mail.rs`
- **resend()** (11 connections) — `server/src/routes/account.rs`
- **State** (11 connections)
- **set_password()** (11 connections) — `server/src/routes/account.rs`
- *... and 85 more nodes in this community*

## Relationships

- [App State & Arena Routes](App_State_&_Arena_Routes.md) (38 shared connections)
- [Social & Trades API](Social_&_Trades_API.md) (35 shared connections)
- [Game Core & Item Insert](Game_Core_&_Item_Insert.md) (26 shared connections)
- [Admin API (Rust)](Admin_API_Rust.md) (22 shared connections)
- [Player State & Market Core](Player_State_&_Market_Core.md) (18 shared connections)
- [HTTP Pages & Errors](HTTP_Pages_&_Errors.md) (17 shared connections)
- [auth.rs / client_ip()](auth.rs_-_client_ip.md) (15 shared connections)
- [Arcade Games Server (turbo/pinball)](Arcade_Games_Server_turbo-pinball.md) (14 shared connections)
- [Events & Common Helpers](Events_&_Common_Helpers.md) (11 shared connections)
- [radio.rs / admin_track_upload()](radio.rs_-_admin_track_upload.md) (8 shared connections)
- [roles.rs / backups.rs](roles.rs_-_backups.rs.md) (7 shared connections)
- [gotrue.rs / Failure](gotrue.rs_-_Failure.md) (6 shared connections)

## Source Files

- `server/src/auth.rs`
- `server/src/error.rs`
- `server/src/game/mod.rs`
- `server/src/gotrue.rs`
- `server/src/mail_templates.rs`
- `server/src/routes/account.rs`
- `server/src/routes/account_mail.rs`
- `server/src/routes/admin.rs`
- `server/src/tokens.rs`

## Audit Trail

- EXTRACTED: 491 (83%)
- INFERRED: 99 (17%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*