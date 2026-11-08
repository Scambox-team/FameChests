# Uruchamianie gry na własnym komputerze

Potrzebna jest baza **PostgreSQL** (wersja Rust nie używa SQLite). Najprościej w Dockerze.

## 0. Najprościej: cała gra w Dockerze

Bez instalowania Rusta i Node (potrzebny tylko Docker). W głównym folderze repozytorium:

```sh
./lokalnie.sh        # Windows (PowerShell): .\lokalnie.ps1
```

Skrypt buduje obraz i uruchamia: grę (http://localhost:8000), testową bazę PostgreSQL i Mailpit (http://localhost:8025 -
tu lądują wszystkie maile z gry, nigdzie nie wychodzą). Konto testowe: login `admin`, hasło `admin` (tworzy je start gry
z `DEV_ADMIN_USER` + `DEV_ADMIN_PASSWORD`; tylko do testów, nigdy na produkcji). Dane (zdjęcia kart) są w folderze
`data-lokalne/`, baza w wolumenie `scambox-local-db`. Porty zmienisz w `.env` (wzór: `.env.example`).

Rust nie ma live reload: po zmianie kodu uruchom skrypt ponownie (zależności siedzą w cache'u cargo-chef, więc przebudowa
jest krótka). Zatrzymanie: `Ctrl+C`, potem `docker compose -f docker-compose.local.yml down`. Zaczynanie od zera:
`docker compose -f docker-compose.local.yml down -v` i usunięcie folderu `data-lokalne/`.

## 1. Baza danych (do natywnego `cargo run`)

Potrzebna jest baza **PostgreSQL** (wersja Rust nie używa SQLite). Najprościej testowa baza z `docker-compose.local.yml`
(z głównego folderu):

```sh
docker compose -f docker-compose.local.yml up -d db   # PostgreSQL 16 na localhost:5433, baza "scambox", wolumen scambox-local-db
```

To baza **testowa** (hasło `postgres`, słucha tylko na 127.0.0.1) - nigdy produkcyjna. Masz już kontener z PostgreSQL?
Wystarczy nowa baza:

```sh
docker exec <kontener> psql -U postgres -c "CREATE DATABASE scambox"
```

Tabele tworzą się same przy pierwszym starcie gry. Karty i skrzynki z panelu admina wczytują się z
`seed/catalog_export.json`, a własne zdjęcia z `seed/custom_images/`.

## 2. Plik `.env`

```sh
cd server
cp .env.example .env        # Windows: copy .env.example .env
```

Najważniejsze: `DATABASE_URL=postgres://postgres:postgres@localhost:5433/scambox`. Pozostałe ustawienia opisuje
`.env.example`. Klucz logowania bez `SECRET_KEY` zapisuje się w `secret_key.txt`. Dane (zdjęcia `image_cache/`, klucz, kopie) leżą domyślnie w `data/` w folderze gry (albo w `DATA_DIR`); stare pliki z samego folderu gry przeniosą się tam same przy starcie.

## 3. Start

### Linux

```sh
cd server
cargo run --release
```

### NixOS (bez rustup)

```sh
cd server
nix shell nixpkgs#cargo nixpkgs#rustc nixpkgs#gcc nixpkgs#pkg-config -c cargo run --release
```

### Windows

Potrzebne: [Rust (rustup)](https://rustup.rs) i Visual Studio Build Tools (kompilator C dla biblioteki WebP).
Potem dwuklik `scripts/windows/start.bat`.

Pierwsze budowanie trwa kilka minut. Gra działa na **http://127.0.0.1:5000**. Pierwsze zarejestrowane konto przejmuje
stary zapis, ale nie jest adminem: wpisz jego id w `OWNER_IDS` w `server/.env` i zrestartuj grę (właściciele dostają admina przy starcie).

## Opcje

Dopisywane po `--` (np. `cargo run --release -- --lan`) albo po `scripts/windows/start.bat`:

| Opcja | Co |
|---|---|
| `--lan` | dostęp z innych komputerów w sieci (adres wypisuje się przy starcie) |
| `--test` | osobna baza `scambox_test` (albo `TEST_DATABASE_URL`), port 5001 - do testów, nie psuje prawdziwej gry |
| `--dev` | szablony HTML czytane przy każdym odświeżeniu, więcej logów - nigdy dla innych graczy |

Baza dla `--test` musi istnieć: `docker exec <kontener> psql -U postgres -c "CREATE DATABASE scambox_test"`.

Komendy:

```sh
cargo run --release -- export-catalog          # zmiany z panelu admina -> seed/catalog_export.json + seed/custom_images/
cargo run --release -- fetch-images [--force]  # pobierz zdjęcia kart (główne i alternatywne)
```

Zatrzymanie: `Ctrl+C`. Druga kopia gry na zajętym porcie się nie uruchomi.

## Gra w Dockerze (bez instalowania Rusta)

Zbudowanie obrazu (z głównego folderu gry):

```sh
docker build -t scambox .
```

Uruchomienie z bazą w innym kontenerze - kontener gry musi być w tej samej sieci Docker co baza:

```sh
docker inspect <kontener-bazy> --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'   # nazwa sieci

docker run -d --name scambox -p 8000:8000 --network <sieć> \
  -e DATABASE_URL=postgres://postgres:postgres@<kontener-bazy>:5432/scambox \
  -e COOKIE_SECURE=0 \
  -e SECRET_KEY=<długi losowy tekst, np. openssl rand -hex 32> \
  -e DATA_DIR=/data -v scambox-data:/data \
  scambox
```

Gra: **http://127.0.0.1:8000**.

- `COOKIE_SECURE=0` - lokalnie gra działa po zwykłym `http://`. Bez tego przeglądarka nie zapamięta logowania.
- Stały `SECRET_KEY` - inaczej po każdym `docker run` wszyscy są wylogowani.
- Wolumen `scambox-data` trzyma pobrane zdjęcia kart.
- `DEV_ADMIN_USER` + `DEV_ADMIN_PASSWORD` (opcjonalnie) - konto testowe z uprawnieniami admina, tworzone przy starcie, gdy nie istnieje; nie ustawiaj na produkcji.

Zarządzanie:

```sh
docker logs -f scambox     # logi
docker stop scambox        # zatrzymanie
docker start scambox       # ponowny start (ta sama baza i zdjęcia)
docker rm -f scambox       # usunięcie kontenera (dane zostają w bazie i w wolumenie)
```

## Problemy

| Objaw | Przyczyna |
|---|---|
| `Brak połączenia z bazą (...)` | zły `DATABASE_URL`, baza nie działa albo kontener gry jest w innej sieci Docker niż baza |
| `database "scambox" does not exist` | utwórz bazę (`CREATE DATABASE scambox`) |
| `Gra już działa (port ... jest zajęty)` | gra działa w innym oknie - zamknij je albo użyj `PORT=...` |
| logowanie "nie trzyma się" | `COOKIE_SECURE=1` na zwykłym `http://` - ustaw `COOKIE_SECURE=0` |
| błędy `sqlx` przy budowaniu | brak `SQLX_OFFLINE=true` w `.env` (budowanie bez bazy z `server/.sqlx/`) |
