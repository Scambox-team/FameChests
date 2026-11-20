# Arcade Games Server (turbo/pinball)

> 88 nodes · cohesion 0.05

## Key Concepts

- **JsonBody** (159 connections) — `server/src/routes/mod.rs`
- **arcade.rs** (50 connections) — `server/src/routes/arcade.rs`
- **turbo_run.rs** (49 connections) — `server/src/routes/turbo_run.rs`
- **pinball.rs** (43 connections) — `server/src/routes/pinball.rs`
- **run_finish()** (20 connections) — `server/src/routes/turbo_run.rs`
- **pinball_finish()** (17 connections) — `server/src/routes/pinball.rs`
- **admin_arcade_save()** (16 connections) — `server/src/routes/arcade.rs`
- **Arcade** (14 connections) — `server/src/routes/arcade.rs`
- **admin_run_save()** (11 connections) — `server/src/routes/turbo_run.rs`
- **turbo_card()** (11 connections) — `server/src/routes/turbo_run.rs`
- **game_of()** (10 connections) — `server/src/routes/arcade.rs`
- **reward_cfg()** (10 connections) — `server/src/routes/arcade.rs`
- **pinball_start()** (10 connections) — `server/src/routes/pinball.rs`
- **pick_card()** (8 connections) — `server/src/routes/pinball.rs`
- **CommitRequest** (8 connections) — `server/src/routes/snake.rs`
- **put_setting()** (8 connections) — `server/src/routes/snake.rs`
- **admin_arcade()** (7 connections) — `server/src/routes/arcade.rs`
- **reward_cfg()** (7 connections) — `server/src/routes/turbo_run.rs`
- **run_config()** (7 connections) — `server/src/routes/turbo_run.rs`
- **arcade_commit()** (6 connections) — `server/src/routes/arcade.rs`
- **arcade_start()** (6 connections) — `server/src/routes/arcade.rs`
- **replay()** (6 connections) — `server/src/routes/arcade.rs`
- **info()** (6 connections) — `server/src/routes/pinball.rs`
- **admin_run()** (6 connections) — `server/src/routes/turbo_run.rs`
- **TICKETS** (5 connections) — `server/src/routes/arcade.rs`
- *... and 63 more nodes in this community*

## Relationships

- [Player State & Market Core](Player_State_&_Market_Core.md) (65 shared connections)
- [Admin API (Rust)](Admin_API_Rust.md) (30 shared connections)
- [Social & Trades API](Social_&_Trades_API.md) (29 shared connections)
- [Variants Admin API](Variants_Admin_API.md) (21 shared connections)
- [Events & Common Helpers](Events_&_Common_Helpers.md) (18 shared connections)
- [App State & Arena Routes](App_State_&_Arena_Routes.md) (18 shared connections)
- [Game Core & Item Insert](Game_Core_&_Item_Insert.md) (16 shared connections)
- [Accounts & Auth Mail](Accounts_&_Auth_Mail.md) (14 shared connections)
- [Casino Routes (Rust)](Casino_Routes_Rust.md) (10 shared connections)
- [Piggy Bank Quest](Piggy_Bank_Quest.md) (7 shared connections)
- [Horse Racing Server](Horse_Racing_Server.md) (6 shared connections)
- [Catalog & Quests](Catalog_&_Quests.md) (6 shared connections)

## Source Files

- `server/src/routes/arcade.rs`
- `server/src/routes/horses.rs`
- `server/src/routes/mod.rs`
- `server/src/routes/pinball.rs`
- `server/src/routes/snake.rs`
- `server/src/routes/turbo_run.rs`

## Audit Trail

- EXTRACTED: 467 (93%)
- INFERRED: 34 (7%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*