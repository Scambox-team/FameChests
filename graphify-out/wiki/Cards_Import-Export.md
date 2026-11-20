# Cards Import/Export

> 61 nodes · cohesion 0.08

## Key Concepts

- **cards_io.rs** (80 connections) — `server/src/routes/cards_io.rs`
- **prepare()** (24 connections) — `server/src/routes/cards_io.rs`
- **Value** (15 connections)
- **admin_import_cards()** (13 connections) — `server/src/routes/cards_io.rs`
- **admin_cards_template()** (10 connections) — `server/src/routes/cards_io.rs`
- **admin_export_cards()** (10 connections) — `server/src/routes/cards_io.rs`
- **field()** (10 connections) — `server/src/routes/cards_io.rs`
- **template_csv()** (9 connections) — `server/src/routes/cards_io.rs`
- **export_import_roundtrip_for_builtin_card()** (8 connections) — `server/src/routes/cards_io.rs`
- **field_specs()** (7 connections) — `server/src/routes/cards_io.rs`
- **file_response()** (7 connections) — `server/src/routes/cards_io.rs`
- **rows_from_text()** (7 connections) — `server/src/routes/cards_io.rs`
- **sample_cards()** (7 connections) — `server/src/routes/cards_io.rs`
- **csv_parse()** (6 connections) — `server/src/routes/cards_io.rs`
- **csv_template_with_comments_parses()** (6 connections) — `server/src/routes/cards_io.rs`
- **Spec** (6 connections) — `server/src/routes/cards_io.rs`
- **text()** (6 connections) — `server/src/routes/cards_io.rs`
- **wiki()** (6 connections) — `server/src/routes/cards_io.rs`
- **card_value()** (5 connections) — `server/src/routes/cards_io.rs`
- **csv_header()** (5 connections) — `server/src/routes/cards_io.rs`
- **csv_row()** (5 connections) — `server/src/routes/cards_io.rs`
- **csv_write()** (5 connections) — `server/src/routes/cards_io.rs`
- **json_template_lists_allowed_values_and_imports()** (5 connections) — `server/src/routes/cards_io.rs`
- **Outcome** (5 connections) — `server/src/routes/cards_io.rs`
- **resolve()** (5 connections) — `server/src/routes/cards_io.rs`
- *... and 36 more nodes in this community*

## Relationships

- [Admin API (Rust)](Admin_API_Rust.md) (13 shared connections)
- [Catalog & Quests](Catalog_&_Quests.md) (9 shared connections)
- [Variants Admin API](Variants_Admin_API.md) (7 shared connections)
- [Catalog Builder](Catalog_Builder.md) (6 shared connections)
- [Social & Trades API](Social_&_Trades_API.md) (4 shared connections)
- [App State & Arena Routes](App_State_&_Arena_Routes.md) (4 shared connections)
- [Events & Common Helpers](Events_&_Common_Helpers.md) (3 shared connections)
- [HTTP Pages & Errors](HTTP_Pages_&_Errors.md) (3 shared connections)
- [Arcade Games Server (turbo/pinball)](Arcade_Games_Server_turbo-pinball.md) (3 shared connections)
- [Poker Server](Poker_Server.md) (2 shared connections)
- [radio.rs / admin_track_upload()](radio.rs_-_admin_track_upload.md) (2 shared connections)
- [roles.rs / backups.rs](roles.rs_-_backups.rs.md) (1 shared connections)

## Source Files

- `server/src/routes/cards_io.rs`

## Audit Trail

- EXTRACTED: 192 (90%)
- INFERRED: 22 (10%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*