# claim() / my_referral()

> 21 nodes · cohesion 0.18

## Key Concepts

- **claim()** (21 connections) — `server/src/routes/referral.rs`
- **my_referral()** (19 connections) — `server/src/routes/referral.rs`
- **users_by_id()** (15 connections) — `server/src/game/mod.rs`
- **ref_landing()** (14 connections) — `server/src/routes/referral.rs`
- **config()** (11 connections) — `server/src/routes/referral.rs`
- **settle()** (11 connections) — `server/src/routes/referral.rs`
- **ref_invite()** (9 connections) — `server/src/routes/referral.rs`
- **ip_hash()** (7 connections) — `server/src/routes/referral.rs`
- **notes()** (7 connections) — `server/src/routes/referral.rs`
- **attach()** (6 connections) — `server/src/routes/referral.rs`
- **code_owner()** (6 connections) — `server/src/routes/referral.rs`
- **note_ip()** (6 connections) — `server/src/routes/referral.rs`
- **HeaderMap** (5 connections)
- **settle_referred()** (5 connections) — `server/src/routes/referral.rs`
- **RefNote** (4 connections) — `server/src/routes/referral.rs`
- **ConnectInfo** (4 connections)
- **SocketAddr** (4 connections)
- **site_url()** (3 connections) — `server/src/routes/referral.rs`
- **IndexMap** (2 connections)
- **ClaimRequest** (2 connections) — `server/src/routes/referral.rs`
- **Item** (1 connections)

## Relationships

- [referral.rs / valid_chest_kind()](referral.rs_-_valid_chest_kind.md) (37 shared connections)
- [Game Core & Item Insert](Game_Core_&_Item_Insert.md) (12 shared connections)
- [Accounts & Auth Mail](Accounts_&_Auth_Mail.md) (6 shared connections)
- [App State & Arena Routes](App_State_&_Arena_Routes.md) (6 shared connections)
- [clean_code() / extract_code()](clean_code_-_extract_code.md) (5 shared connections)
- [Catalog & Quests](Catalog_&_Quests.md) (4 shared connections)
- [Social & Trades API](Social_&_Trades_API.md) (4 shared connections)
- [Market Routes](Market_Routes.md) (3 shared connections)
- [Player State & Market Core](Player_State_&_Market_Core.md) (3 shared connections)
- [auth.rs / client_ip()](auth.rs_-_client_ip.md) (3 shared connections)
- [Passport (GPS stamps)](Passport_GPS_stamps.md) (1 shared connections)
- [Casino Routes (Rust)](Casino_Routes_Rust.md) (1 shared connections)

## Source Files

- `server/src/game/mod.rs`
- `server/src/routes/referral.rs`

## Audit Trail

- EXTRACTED: 114 (91%)
- INFERRED: 11 (9%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*