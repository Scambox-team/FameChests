# Mapa plikow serwera (main, startup, cata

> 9 nodes · cohesion 0.31

## Key Concepts

- **Mapa plikow serwera (main, startup, catalog, auth, routes...)** (8 connections) — `server/README.md`
- **server/data/game.json (jedyne zrodlo danych gry)** (6 connections) — `CLAUDE.md`
- **Serwer Rust (axum, tokio, sqlx)** (6 connections) — `CLAUDE.md`
- **Arena (walki liczone na serwerze, tylko admini)** (4 connections) — `CLAUDE.md`
- **catalog.rs (game.json + zmiany z panelu admina)** (3 connections) — `CLAUDE.md`
- **Jeden proces (bez load balancera)** (3 connections) — `docs/hosting.md`
- **Zasady hostingu: jeden proces, zmienne srodowiskowe** (2 connections) — `CLAUDE.md`
- **schema.sql (jedyny schemat PostgreSQL)** (2 connections) — `CLAUDE.md`
- **Nowa kolumna/tabela: schema.sql + migracja w startup.rs** (1 connections) — `docs/rozwoj.md`

## Relationships

- [System wariantow kart (VX_BG / VX_PHOTO ](System_wariantow_kart_VX_BG_-_VX_PHOTO_.md) (3 shared connections)
- [Azure App Service Windows (scambox.exe) ](Azure_App_Service_Windows_scambox.exe_.md) (3 shared connections)
- [Natywny cargo run (Linux, NixOS, Windows](Natywny_cargo_run_Linux,_NixOS,_Windows.md) (2 shared connections)
- [Rola owner (OWNER_IDS, guard_owner) / Zm](Rola_owner_OWNER_IDS,_guard_owner_-_Zm.md) (1 shared connections)
- [Self-hosted stack (gra + Supabase + HTTP](Self-hosted_stack_gra_+_Supabase_+_HTTP.md) (1 shared connections)
- [Bot Discorda ScamBox / Osiagniecia (achi](Bot_Discorda_ScamBox_-_Osiagniecia_achi.md) (1 shared connections)
- [Kasyno (ruletka, blackjack, bandyta, pok](Kasyno_ruletka,_blackjack,_bandyta,_pok.md) (1 shared connections)
- [Import i eksport kart (cards_io.rs) / Ob](Import_i_eksport_kart_cards_io.rs_-_Ob.md) (1 shared connections)

## Source Files

- `CLAUDE.md`
- `docs/hosting.md`
- `docs/rozwoj.md`
- `server/README.md`

## Audit Trail

- EXTRACTED: 19 (79%)
- INFERRED: 5 (21%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*