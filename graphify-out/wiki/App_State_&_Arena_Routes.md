# App State & Arena Routes

> 48 nodes · cohesion 0.09

## Key Concepts

- **AppState** (393 connections) — `server/src/state.rs`
- **arena.rs** (67 connections) — `server/src/routes/arena.rs`
- **state.rs** (16 connections) — `server/src/state.rs`
- **arena_start()** (14 connections) — `server/src/routes/arena.rs`
- **admin_ctf_save()** (14 connections) — `server/src/routes/ctf.rs`
- **arena_accept()** (13 connections) — `server/src/routes/arena.rs`
- **arena_reply()** (13 connections) — `server/src/routes/arena.rs`
- **arena_challenge()** (12 connections) — `server/src/routes/arena.rs`
- **arena_act()** (9 connections) — `server/src/routes/arena.rs`
- **arena_record()** (9 connections) — `server/src/routes/arena.rs`
- **arena_battle()** (8 connections) — `server/src/routes/arena.rs`
- **arena_deck()** (8 connections) — `server/src/routes/arena.rs`
- **State** (8 connections)
- **admin_ctf()** (7 connections) — `server/src/routes/ctf.rs`
- **by_token()** (7 connections) — `server/src/routes/ctf.rs`
- **CATALOG** (7 connections) — `server/src/state.rs`
- **arena_abandon()** (6 connections) — `server/src/routes/arena.rs`
- **arena_inbox()** (6 connections) — `server/src/routes/arena.rs`
- **hero()** (6 connections) — `server/src/routes/arena.rs`
- **enabled()** (6 connections) — `server/src/routes/ctf.rs`
- **ArenaState** (5 connections) — `server/src/arena/mod.rs`
- **arena_decline()** (5 connections) — `server/src/routes/arena.rs`
- **BattleReply** (5 connections) — `server/src/routes/arena.rs`
- **deck_error()** (5 connections) — `server/src/routes/arena.rs`
- **arena_wins_today()** (4 connections) — `server/src/routes/arena.rs`
- *... and 23 more nodes in this community*

## Relationships

- [Admin API (Rust)](Admin_API_Rust.md) (61 shared connections)
- [Accounts & Auth Mail](Accounts_&_Auth_Mail.md) (38 shared connections)
- [Social & Trades API](Social_&_Trades_API.md) (34 shared connections)
- [Player State & Market Core](Player_State_&_Market_Core.md) (32 shared connections)
- [Variants Admin API](Variants_Admin_API.md) (24 shared connections)
- [CTF Quest](CTF_Quest.md) (21 shared connections)
- [Events & Common Helpers](Events_&_Common_Helpers.md) (18 shared connections)
- [Arcade Games Server (turbo/pinball)](Arcade_Games_Server_turbo-pinball.md) (18 shared connections)
- [Casino Routes (Rust)](Casino_Routes_Rust.md) (18 shared connections)
- [Game Core & Item Insert](Game_Core_&_Item_Insert.md) (16 shared connections)
- [Bot API](Bot_API.md) (16 shared connections)
- [HTTP Pages & Errors](HTTP_Pages_&_Errors.md) (15 shared connections)

## Source Files

- `server/src/arena/mod.rs`
- `server/src/auth.rs`
- `server/src/routes/arena.rs`
- `server/src/routes/ctf.rs`
- `server/src/state.rs`

## Audit Trail

- EXTRACTED: 582 (97%)
- INFERRED: 16 (3%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*