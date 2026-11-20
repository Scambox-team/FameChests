# Rola owner (OWNER_IDS, guard_owner) / Zm

> 13 nodes · cohesion 0.19

## Key Concepts

- **Rola owner (OWNER_IDS, guard_owner)** (5 connections) — `CLAUDE.md`
- **Zmienne srodowiskowe (DATABASE_URL, SECRET_KEY, DATA_DIR...)** (5 connections) — `docs/hosting.md`
- **Panel admina (adminMenu.ts, jedno menu)** (4 connections) — `CLAUDE.md`
- **Kopie zapasowe bazy (backup.rs, pg_dump)** (4 connections) — `CLAUDE.md`
- **Kopie zapasowe i odtworzenie (owner)** (4 connections) — `deploy/selfhost/README.md`
- **update.sh (aktualizacja z rollbackiem)** (3 connections) — `deploy/selfhost/README.md`
- **Regula: nie ruszac bazy produkcyjnej, testowac na kopii** (2 connections) — `CLAUDE.md`
- **Obraz gry z ghcr.io (CI po pushu do main)** (2 connections) — `deploy/selfhost/README.md`
- **Migracja danych z Azure / Supabase w chmurze** (2 connections) — `deploy/selfhost/README.md`
- **Azure App Service Linux (obraz Docker)** (2 connections) — `docs/hosting.md`
- **Test na kopii prawdziwej bazy (pg_dump)** (2 connections) — `docs/przejscie-z-pythona.md`
- **Regulamin, prywatnosc i zgloszenia kart (TERMS_VERSION)** (1 connections) — `CLAUDE.md`
- **Metryki Prometheus (METRICS_ADDR)** (1 connections) — `docs/hosting.md`

## Relationships

- [Self-hosted stack (gra + Supabase + HTTP](Self-hosted_stack_gra_+_Supabase_+_HTTP.md) (2 shared connections)
- [Azure App Service Windows (scambox.exe) ](Azure_App_Service_Windows_scambox.exe_.md) (2 shared connections)
- [Mapa plikow serwera (main, startup, cata](Mapa_plikow_serwera_main,_startup,_cata.md) (1 shared connections)
- [Import i eksport kart (cards_io.rs) / Ob](Import_i_eksport_kart_cards_io.rs_-_Ob.md) (1 shared connections)
- [Natywny cargo run (Linux, NixOS, Windows](Natywny_cargo_run_Linux,_NixOS,_Windows.md) (1 shared connections)

## Source Files

- `CLAUDE.md`
- `deploy/selfhost/README.md`
- `docs/hosting.md`
- `docs/przejscie-z-pythona.md`

## Audit Trail

- EXTRACTED: 17 (77%)
- INFERRED: 5 (23%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*