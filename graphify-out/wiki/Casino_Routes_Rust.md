# Casino Routes (Rust)

> 118 nodes · cohesion 0.05

## Key Concepts

- **casino.rs** (120 connections) — `server/src/routes/casino.rs`
- **bj_end()** (20 connections) — `server/src/routes/casino.rs`
- **take_my_items()** (19 connections) — `server/src/game/mod.rs`
- **casino_blackjack_deal()** (18 connections) — `server/src/routes/casino.rs`
- **casino_plinko()** (18 connections) — `server/src/routes/casino.rs`
- **State** (18 connections)
- **casino_jackpot_ready()** (17 connections) — `server/src/routes/casino.rs`
- **casino_slots()** (17 connections) — `server/src/routes/casino.rs`
- **pay_out()** (17 connections) — `server/src/routes/casino.rs`
- **row_value()** (16 connections) — `server/src/game/mod.rs`
- **casino_roulette()** (16 connections) — `server/src/routes/casino.rs`
- **casino_blackjack_double()** (15 connections) — `server/src/routes/casino.rs`
- **casino_jackpot_cards()** (14 connections) — `server/src/routes/casino.rs`
- **casino_jackpot_create()** (13 connections) — `server/src/routes/casino.rs`
- **casino_jackpot_join()** (13 connections) — `server/src/routes/casino.rs`
- **casino_jackpot_settings()** (13 connections) — `server/src/routes/casino.rs`
- **Jackpot** (13 connections) — `server/src/routes/casino.rs`
- **Ctx** (13 connections)
- **stake_error()** (13 connections) — `server/src/routes/casino.rs`
- **Card** (12 connections) — `server/src/routes/casino.rs`
- **jackpots_json()** (12 connections) — `server/src/routes/casino.rs`
- **lobby_reply()** (12 connections) — `server/src/routes/casino.rs`
- **BjGame** (11 connections) — `server/src/routes/casino.rs`
- **casino_blackjack_hit()** (11 connections) — `server/src/routes/casino.rs`
- **casino_jackpot_kick()** (11 connections) — `server/src/routes/casino.rs`
- *... and 93 more nodes in this community*

## Relationships

- [Game Core & Item Insert](Game_Core_&_Item_Insert.md) (56 shared connections)
- [Player State & Market Core](Player_State_&_Market_Core.md) (54 shared connections)
- [Social & Trades API](Social_&_Trades_API.md) (34 shared connections)
- [App State & Arena Routes](App_State_&_Arena_Routes.md) (18 shared connections)
- [Horse Racing Server](Horse_Racing_Server.md) (17 shared connections)
- [Arcade Games Server (turbo/pinball)](Arcade_Games_Server_turbo-pinball.md) (10 shared connections)
- [Variants Admin API](Variants_Admin_API.md) (9 shared connections)
- [Shop & Contracts](Shop_&_Contracts.md) (6 shared connections)
- [Events & Common Helpers](Events_&_Common_Helpers.md) (6 shared connections)
- [HTTP Pages & Errors](HTTP_Pages_&_Errors.md) (6 shared connections)
- [Achievements Engine](Achievements_Engine.md) (6 shared connections)
- [Market Routes](Market_Routes.md) (5 shared connections)

## Source Files

- `server/src/db.rs`
- `server/src/game/mod.rs`
- `server/src/routes/casino.rs`
- `server/src/routes/pages.rs`

## Audit Trail

- EXTRACTED: 462 (83%)
- INFERRED: 96 (17%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*