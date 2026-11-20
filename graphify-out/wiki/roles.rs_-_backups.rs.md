# roles.rs / backups.rs

> 36 nodes · cohesion 0.11

## Key Concepts

- **roles.rs** (39 connections) — `server/src/routes/roles.rs`
- **backups.rs** (21 connections) — `server/src/routes/backups.rs`
- **Owner** (14 connections) — `server/src/auth.rs`
- **Kind** (10 connections)
- **gate()** (9 connections) — `server/src/routes/roles.rs`
- **role_assign()** (9 connections) — `server/src/routes/roles.rs`
- **role_save()** (9 connections) — `server/src/routes/roles.rs`
- **backup_create()** (7 connections) — `server/src/routes/backups.rs`
- **backup_download()** (7 connections) — `server/src/routes/backups.rs`
- **role_delete()** (7 connections) — `server/src/routes/roles.rs`
- **State** (7 connections)
- **staff_of()** (7 connections) — `server/src/routes/roles.rs`
- **FromRequestParts** (6 connections)
- **admin_role()** (6 connections) — `server/src/routes/roles.rs`
- **need()** (6 connections) — `server/src/routes/roles.rs`
- **roles_list()** (6 connections) — `server/src/routes/roles.rs`
- **backups_list()** (5 connections) — `server/src/routes/backups.rs`
- **Need** (5 connections) — `server/src/routes/roles.rs`
- **State** (4 connections)
- **Staff** (4 connections) — `server/src/routes/roles.rs`
- **parse_perms()** (3 connections) — `server/src/routes/roles.rs`
- **paths()** (3 connections) — `server/src/routes/roles.rs`
- **perm()** (3 connections) — `server/src/routes/roles.rs`
- **.can()** (3 connections) — `server/src/routes/roles.rs`
- **AssignRequest** (2 connections) — `server/src/routes/roles.rs`
- *... and 11 more nodes in this community*

## Relationships

- [App State & Arena Routes](App_State_&_Arena_Routes.md) (13 shared connections)
- [Admin API (Rust)](Admin_API_Rust.md) (12 shared connections)
- [HTTP Pages & Errors](HTTP_Pages_&_Errors.md) (10 shared connections)
- [Social & Trades API](Social_&_Trades_API.md) (10 shared connections)
- [Events & Common Helpers](Events_&_Common_Helpers.md) (7 shared connections)
- [Accounts & Auth Mail](Accounts_&_Auth_Mail.md) (7 shared connections)
- [Arcade Games Server (turbo/pinball)](Arcade_Games_Server_turbo-pinball.md) (3 shared connections)
- [auth.rs / client_ip()](auth.rs_-_client_ip.md) (2 shared connections)
- [AuthReject / load_user()](AuthReject_-_load_user.md) (2 shared connections)
- [backup.rs / Backups](backup.rs_-_Backups.md) (2 shared connections)
- [Player State & Market Core](Player_State_&_Market_Core.md) (1 shared connections)
- [export.rs / export_catalog()](export.rs_-_export_catalog.md) (1 shared connections)

## Source Files

- `server/src/auth.rs`
- `server/src/routes/backups.rs`
- `server/src/routes/roles.rs`

## Audit Trail

- EXTRACTED: 138 (93%)
- INFERRED: 11 (7%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*