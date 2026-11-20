# AuthReject / load_user()

> 19 nodes · cohesion 0.18

## Key Concepts

- **AuthReject** (11 connections) — `server/src/auth.rs`
- **load_user()** (11 connections) — `server/src/auth.rs`
- **.from_request_parts()** (8 connections) — `server/src/auth.rs`
- **.from_request_parts()** (8 connections) — `server/src/auth.rs`
- **Parts** (6 connections)
- **clear_session()** (5 connections) — `server/src/auth.rs`
- **.from_request_parts()** (5 connections) — `server/src/auth.rs`
- **.from_request_parts()** (5 connections) — `server/src/auth.rs`
- **SignedCookieJar** (5 connections)
- **session_uid()** (5 connections) — `server/src/auth.rs`
- **Rejection** (4 connections)
- **.into_response()** (3 connections) — `server/src/auth.rs`
- **Api** (2 connections) — `server/src/auth.rs`
- **Forbidden** (2 connections) — `server/src/auth.rs`
- **Page** (2 connections) — `server/src/auth.rs`
- **IntoResponse** (2 connections)
- **Response** (2 connections)
- **Internal** (1 connections) — `server/src/auth.rs`
- **OwnerOnly** (1 connections) — `server/src/auth.rs`

## Relationships

- [auth.rs / client_ip()](auth.rs_-_client_ip.md) (8 shared connections)
- [App State & Arena Routes](App_State_&_Arena_Routes.md) (5 shared connections)
- [Accounts & Auth Mail](Accounts_&_Auth_Mail.md) (4 shared connections)
- [User / .view()](User_-_.view.md) (2 shared connections)
- [roles.rs / backups.rs](roles.rs_-_backups.rs.md) (2 shared connections)
- [Achievements Engine](Achievements_Engine.md) (2 shared connections)
- [Admin API (Rust)](Admin_API_Rust.md) (1 shared connections)
- [HTTP Pages & Errors](HTTP_Pages_&_Errors.md) (1 shared connections)
- [Player State & Market Core](Player_State_&_Market_Core.md) (1 shared connections)

## Source Files

- `server/src/auth.rs`

## Audit Trail

- EXTRACTED: 54 (95%)
- INFERRED: 3 (5%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*