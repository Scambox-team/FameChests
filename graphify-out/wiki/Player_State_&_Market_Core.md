# Player State & Market Core

> 66 nodes · cohesion 0.10

## Key Concepts

- **Me** (174 connections) — `server/src/auth.rs`
- **lock_me()** (95 connections) — `server/src/db.rs`
- **get_state()** (52 connections) — `server/src/game/mod.rs`
- **add_state()** (39 connections) — `server/src/game/mod.rs`
- **game/market.rs** (31 connections) — `server/src/game/market.rs`
- **settle_market()** (31 connections) — `server/src/game/market.rs`
- **open_crates()** (23 connections) — `server/src/routes/shop.rs`
- **state()** (23 connections) — `server/src/routes/shop.rs`
- **snake_finish()** (23 connections) — `server/src/routes/snake.rs`
- **arcade_finish()** (21 connections) — `server/src/routes/arcade.rs`
- **get_chests()** (18 connections) — `server/src/game/mod.rs`
- **gift.rs** (18 connections) — `server/src/routes/gift.rs`
- **market_bid()** (18 connections) — `server/src/routes/market.rs`
- **give_items()** (17 connections) — `server/src/game/mod.rs`
- **market_offer_action()** (17 connections) — `server/src/routes/market.rs`
- **market_wanted_create()** (16 connections) — `server/src/routes/market.rs`
- **add_chests()** (15 connections) — `server/src/game/mod.rs`
- **market_buy()** (15 connections) — `server/src/routes/market.rs`
- **market_offer()** (15 connections) — `server/src/routes/market.rs`
- **buy_chests()** (15 connections) — `server/src/routes/shop.rs`
- **market_list()** (14 connections) — `server/src/routes/market.rs`
- **market_wanted_fill()** (14 connections) — `server/src/routes/market.rs`
- **open_money_chest()** (14 connections) — `server/src/routes/shop.rs`
- **contract()** (13 connections) — `server/src/routes/shop.rs`
- **contracts_bulk()** (13 connections) — `server/src/routes/shop.rs`
- *... and 41 more nodes in this community*

## Relationships

- [Game Core & Item Insert](Game_Core_&_Item_Insert.md) (75 shared connections)
- [Arcade Games Server (turbo/pinball)](Arcade_Games_Server_turbo-pinball.md) (65 shared connections)
- [Casino Routes (Rust)](Casino_Routes_Rust.md) (54 shared connections)
- [Social & Trades API](Social_&_Trades_API.md) (52 shared connections)
- [Market Routes](Market_Routes.md) (33 shared connections)
- [App State & Arena Routes](App_State_&_Arena_Routes.md) (32 shared connections)
- [Shop & Contracts](Shop_&_Contracts.md) (31 shared connections)
- [Events & Common Helpers](Events_&_Common_Helpers.md) (26 shared connections)
- [Horse Racing Server](Horse_Racing_Server.md) (20 shared connections)
- [routes/chess.rs / State](routes-chess.rs_-_State.md) (19 shared connections)
- [Accounts & Auth Mail](Accounts_&_Auth_Mail.md) (18 shared connections)
- [Poker Server](Poker_Server.md) (16 shared connections)

## Source Files

- `server/src/auth.rs`
- `server/src/db.rs`
- `server/src/game/market.rs`
- `server/src/game/mod.rs`
- `server/src/routes/arcade.rs`
- `server/src/routes/bot.rs`
- `server/src/routes/events.rs`
- `server/src/routes/game_rankings.rs`
- `server/src/routes/gift.rs`
- `server/src/routes/market.rs`
- `server/src/routes/shop.rs`
- `server/src/routes/snake.rs`

## Audit Trail

- EXTRACTED: 522 (67%)
- INFERRED: 257 (33%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*