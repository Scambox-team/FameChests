# HTTP Pages & Errors

> 78 nodes · cohesion 0.05

## Key Concepts

- **pages.rs** (52 connections) — `server/src/routes/pages.rs`
- **json** (48 connections)
- **AppError** (40 connections) — `server/src/error.rs`
- **StatusCode** (26 connections)
- **web.rs** (21 connections) — `server/src/web.rs`
- **image()** (19 connections) — `server/src/routes/pages.rs`
- **send_file()** (18 connections) — `server/src/web.rs`
- **routes/mod.rs** (17 connections) — `server/src/routes/mod.rs`
- **MaybeUser** (14 connections) — `server/src/auth.rs`
- **intoresponse** (12 connections)
- **avatar_image()** (12 connections) — `server/src/routes/pages.rs`
- **error.rs** (11 connections) — `server/src/error.rs`
- **mimetype()** (11 connections) — `server/src/images.rs`
- **message_image()** (10 connections) — `server/src/routes/admin.rs`
- **friend_ids()** (8 connections) — `server/src/game/mod.rs`
- **image_kind()** (8 connections) — `server/src/routes/pages.rs`
- **image_main()** (8 connections) — `server/src/routes/pages.rs`
- **login_page()** (8 connections) — `server/src/routes/pages.rs`
- **app_page()** (7 connections) — `server/src/routes/pages.rs`
- **flag_image()** (7 connections) — `server/src/routes/pages.rs`
- **State** (7 connections)
- **Redirect** (6 connections)
- **HeaderMap** (6 connections)
- **svg_response()** (6 connections) — `server/src/web.rs`
- **headervalue** (5 connections)
- *... and 53 more nodes in this community*

## Relationships

- [Social & Trades API](Social_&_Trades_API.md) (21 shared connections)
- [Accounts & Auth Mail](Accounts_&_Auth_Mail.md) (17 shared connections)
- [Admin API (Rust)](Admin_API_Rust.md) (15 shared connections)
- [App State & Arena Routes](App_State_&_Arena_Routes.md) (15 shared connections)
- [Variants Admin API](Variants_Admin_API.md) (12 shared connections)
- [roles.rs / backups.rs](roles.rs_-_backups.rs.md) (10 shared connections)
- [Events & Common Helpers](Events_&_Common_Helpers.md) (10 shared connections)
- [snake.rs / admin_snake_save()](snake.rs_-_admin_snake_save.md) (8 shared connections)
- [Player State & Market Core](Player_State_&_Market_Core.md) (7 shared connections)
- [Game Core & Item Insert](Game_Core_&_Item_Insert.md) (7 shared connections)
- [Achievements Engine](Achievements_Engine.md) (6 shared connections)
- [Borders & Assets](Borders_&_Assets.md) (6 shared connections)

## Source Files

- `server/src/assets.rs`
- `server/src/auth.rs`
- `server/src/error.rs`
- `server/src/game/mod.rs`
- `server/src/images.rs`
- `server/src/routes/admin.rs`
- `server/src/routes/arena.rs`
- `server/src/routes/mod.rs`
- `server/src/routes/pages.rs`
- `server/src/web.rs`

## Audit Trail

- EXTRACTED: 337 (93%)
- INFERRED: 27 (7%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*