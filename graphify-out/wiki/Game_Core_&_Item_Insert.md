# Game Core & Item Insert

> 90 nodes · cohesion 0.05

## Key Concepts

- **Conn** (264 connections) — `server/src/db.rs`
- **game/mod.rs** (71 connections) — `server/src/game/mod.rs`
- **me()** (31 connections) — `server/src/routes/social.rs`
- **hashset** (19 connections)
- **insert_for()** (19 connections) — `server/src/game/mod.rs`
- **upgrade()** (19 connections) — `server/src/routes/shop.rs`
- **profile()** (17 connections) — `server/src/routes/social.rs`
- **set_state()** (16 connections) — `server/src/game/mod.rs`
- **ctf_submit()** (16 connections) — `server/src/routes/ctf.rs`
- **note_drops()** (15 connections) — `server/src/game/mod.rs`
- **insert_item()** (14 connections) — `server/src/game/mod.rs`
- **item_json()** (14 connections) — `server/src/game/mod.rs`
- **ItemJson** (14 connections) — `server/src/game/mod.rs`
- **NewItem** (12 connections) — `server/src/game/mod.rs`
- **collection_stats()** (11 connections) — `server/src/game/mod.rs`
- **drops_of()** (11 connections) — `server/src/game/mod.rs`
- **insert_plain()** (11 connections) — `server/src/game/mod.rs`
- **my_items()** (11 connections) — `server/src/game/mod.rs`
- **link_claim()** (11 connections) — `server/src/routes/social.rs`
- **Ctx** (10 connections) — `server/src/game/mod.rs`
- **casino_special_drop()** (10 connections) — `server/src/routes/casino.rs`
- **after_item()** (10 connections) — `server/src/routes/quests.rs`
- **limit_reached()** (9 connections) — `server/src/routes/quests.rs`
- **MeResponse** (9 connections) — `server/src/routes/social.rs`
- **take_bonus_notes()** (8 connections) — `server/src/game/market.rs`
- *... and 65 more nodes in this community*

## Relationships

- [Player State & Market Core](Player_State_&_Market_Core.md) (75 shared connections)
- [Casino Routes (Rust)](Casino_Routes_Rust.md) (56 shared connections)
- [Social & Trades API](Social_&_Trades_API.md) (44 shared connections)
- [Achievements Engine](Achievements_Engine.md) (33 shared connections)
- [Catalog & Quests](Catalog_&_Quests.md) (31 shared connections)
- [Accounts & Auth Mail](Accounts_&_Auth_Mail.md) (26 shared connections)
- [Shop & Contracts](Shop_&_Contracts.md) (22 shared connections)
- [Variants Admin API](Variants_Admin_API.md) (19 shared connections)
- [Horse Racing Server](Horse_Racing_Server.md) (17 shared connections)
- [CTF Quest](CTF_Quest.md) (17 shared connections)
- [Admin API (Rust)](Admin_API_Rust.md) (16 shared connections)
- [App State & Arena Routes](App_State_&_Arena_Routes.md) (16 shared connections)

## Source Files

- `server/src/achievements.rs`
- `server/src/db.rs`
- `server/src/game/market.rs`
- `server/src/game/mod.rs`
- `server/src/routes/admin.rs`
- `server/src/routes/casino.rs`
- `server/src/routes/chess.rs`
- `server/src/routes/ctf.rs`
- `server/src/routes/drawings.rs`
- `server/src/routes/market.rs`
- `server/src/routes/quests.rs`
- `server/src/routes/reports.rs`
- `server/src/routes/scratch.rs`
- `server/src/routes/shop.rs`
- `server/src/routes/social.rs`
- `server/src/routes/themes.rs`
- `server/src/routes/variants.rs`

## Audit Trail

- EXTRACTED: 578 (81%)
- INFERRED: 135 (19%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*