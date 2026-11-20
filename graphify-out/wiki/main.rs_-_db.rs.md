# main.rs / db.rs

> 31 nodes · cohesion 0.09

## Key Concepts

- **main.rs** (25 connections) — `server/src/main.rs`
- **db.rs** (15 connections) — `server/src/db.rs`
- **serve()** (13 connections) — `server/src/main.rs`
- **main()** (6 connections) — `server/src/main.rs`
- **connect()** (5 connections) — `server/src/db.rs`
- **init_schema()** (4 connections) — `server/src/db.rs`
- **track_metrics()** (4 connections) — `server/src/main.rs`
- **router()** (4 connections) — `server/src/routes/mod.rs`
- **PgPool** (3 connections)
- **restore()** (3 connections) — `server/src/routes/poker.rs`
- **Config** (2 connections)
- **lan_address()** (2 connections) — `server/src/main.rs`
- **Config** (2 connections)
- **Next** (2 connections)
- **Request** (2 connections)
- **Response** (2 connections)
- **systemtime** (2 connections)
- **arcswap** (1 connections)
- **compressionlayer** (1 connections)
- **compressionlevel** (1 connections)
- **matchedpath** (1 connections)
- **middleware** (1 connections)
- **pgconnection** (1 connections)
- **pgconnectoptions** (1 connections)
- **pgpooloptions** (1 connections)
- *... and 6 more nodes in this community*

## Relationships

- [startup.rs / init_db()](startup.rs_-_init_db.md) (3 shared connections)
- [config.rs / .load()](config.rs_-_.load.md) (3 shared connections)
- [App State & Arena Routes](App_State_&_Arena_Routes.md) (3 shared connections)
- [backup.rs / Backups](backup.rs_-_Backups.md) (2 shared connections)
- [Images / Kind](Images_-_Kind.md) (2 shared connections)
- [Poker Server](Poker_Server.md) (2 shared connections)
- [HTTP Pages & Errors](HTTP_Pages_&_Errors.md) (2 shared connections)
- [Game Core & Item Insert](Game_Core_&_Item_Insert.md) (1 shared connections)
- [Events & Common Helpers](Events_&_Common_Helpers.md) (1 shared connections)
- [Casino Routes (Rust)](Casino_Routes_Rust.md) (1 shared connections)
- [Player State & Market Core](Player_State_&_Market_Core.md) (1 shared connections)
- [Shop & Contracts](Shop_&_Contracts.md) (1 shared connections)

## Source Files

- `server/src/db.rs`
- `server/src/main.rs`
- `server/src/routes/mod.rs`
- `server/src/routes/poker.rs`

## Audit Trail

- EXTRACTED: 67 (97%)
- INFERRED: 2 (3%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*