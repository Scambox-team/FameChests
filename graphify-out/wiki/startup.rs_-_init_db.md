# startup.rs / init_db()

> 16 nodes · cohesion 0.23

## Key Concepts

- **startup.rs** (22 connections) — `server/src/startup.rs`
- **init_db()** (14 connections) — `server/src/startup.rs`
- **PgPool** (6 connections)
- **drop_removed_variants()** (5 connections) — `server/src/startup.rs`
- **ensure_dev_admin()** (5 connections) — `server/src/startup.rs`
- **map** (4 connections)
- **backfill_hall_of_fame()** (4 connections) — `server/src/startup.rs`
- **drop_variant_everywhere()** (4 connections) — `server/src/startup.rs`
- **migrate_crate_variants()** (4 connections) — `server/src/startup.rs`
- **ESCROW** (3 connections) — `server/src/game/mod.rs`
- **FirstDrop** (2 connections) — `server/src/startup.rs`
- **.note()** (2 connections) — `server/src/startup.rs`
- **Config** (2 connections)
- **assertsqlsafe** (1 connections)
- **VARIANT_COLUMNS** (1 connections) — `server/src/startup.rs`
- **value** (1 connections)

## Relationships

- [main.rs / db.rs](main.rs_-_db.rs.md) (3 shared connections)
- [Catalog & Quests](Catalog_&_Quests.md) (3 shared connections)
- [export.rs / export_catalog()](export.rs_-_export_catalog.md) (3 shared connections)
- [Achievements Engine](Achievements_Engine.md) (2 shared connections)
- [Admin API (Rust)](Admin_API_Rust.md) (2 shared connections)
- [Game Core & Item Insert](Game_Core_&_Item_Insert.md) (2 shared connections)
- [Variants Admin API](Variants_Admin_API.md) (2 shared connections)
- [Accounts & Auth Mail](Accounts_&_Auth_Mail.md) (2 shared connections)
- [snake.rs / admin_snake_save()](snake.rs_-_admin_snake_save.md) (1 shared connections)
- [Horse Racing Server](Horse_Racing_Server.md) (1 shared connections)
- [Events & Common Helpers](Events_&_Common_Helpers.md) (1 shared connections)
- [Borders & Assets](Borders_&_Assets.md) (1 shared connections)

## Source Files

- `server/src/game/mod.rs`
- `server/src/startup.rs`

## Audit Trail

- EXTRACTED: 51 (96%)
- INFERRED: 2 (4%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*