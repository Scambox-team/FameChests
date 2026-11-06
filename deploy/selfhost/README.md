# ScamBox na własnym serwerze (Docker + self-hosted Supabase)

Cała gra w jednym `docker compose`: serwer gry (obraz z `server/Dockerfile`), Supabase z Postgresem 17
(oficjalny zestaw self-hosted) i Caddy, który sam wystawia certyfikat HTTPS.

```
internet ──80/443──> Caddy ──> gra (scambox) ──> Postgres (supabase-db)
                                                   ^
SSH tunel ──127.0.0.1:8000──> Supabase Studio / API ┘   (z internetu niewidoczne)
```

| Plik | Co |
|---|---|
| `docker-compose.yml` | oficjalny plik Supabase - **bez zmian** (wersja: `SUPABASE_VERSION`) |
| `docker-compose.override.yml` | gra + Caddy, porty Supabase zamknięte na 127.0.0.1 (docker compose dokleja go sam) |
| `.env.example` | wzór ustawień; `setup.sh` robi z niego `.env` z losowymi hasłami |
| `migrate-from-supabase.sh` | dane graczy z Supabase w chmurze -> lokalna baza |
| `import-data.sh` | zdjęcia (`DATA_DIR` z Azure) -> wolumen gry |
| `caddy/Caddyfile` | HTTPS dla domeny gry |

## Wymagania

- Linux z Dockerem (Docker Engine + plugin `docker compose` v2.24+), `git`, `openssl`
- ~4 GB RAM wolne (sam Supabase to kilkanaście kontenerów), kilka GB na dysku
- domena (rekord A na IP serwera) i otwarte porty **80 i 443**. Żadnych innych portów nie otwieraj.

## Instalacja

```sh
git clone https://github.com/Scambox-team/FameChests.git
cd FameChests/deploy/selfhost
sh setup.sh                  # .env z losowymi hasłami i kluczami
nano .env                    # GAME_DOMAIN, GAME_SECRET_KEY, GAME_OPERATOR_NAME, GAME_CONTACT_EMAIL
```

Obraz gry - jedno z dwóch:

```sh
docker compose build game    # A) zbuduj z repozytorium (~10-15 min za pierwszym razem)
```

```sh
# B) gotowy obraz z GitHuba (budowany przez CI po każdym pushu do main; pakiet jest prywatny -
#    potrzebny token GitHub classic z read:packages od kogoś z zespołu)
echo <token> | docker login ghcr.io -u <login-github> --password-stdin
sed -i 's|^GAME_IMAGE=.*|GAME_IMAGE=ghcr.io/scambox-team/famechests:latest|' .env
docker compose pull game
```

## Przeniesienie danych z Azure / Supabase w chmurze

Robi to ktoś z zespołu, kto ma dostęp do Azure (adres bazy i klucze są tam).

1. **Zatrzymaj grę na Azure** (portal -> App Service -> *Stop*) - od tej chwili gracze nic nie zmieniają.
2. Z Azure (*Configuration / Environment variables*) przepisz do `.env`:
   - `SECRET_KEY` -> `GAME_SECRET_KEY` (inaczej wszyscy zostaną wylogowani)
   - `DB_SCHEMA` -> `GAME_DB_SCHEMA` (zwykle `famechests`)
   - `OPERATOR_NAME`, `CONTACT_EMAIL` -> `GAME_OPERATOR_NAME`, `GAME_CONTACT_EMAIL`
3. **Baza** (chmura jest tylko czytana; zrzut zostaje w `backups/`):
   ```sh
   sh migrate-from-supabase.sh "<DATABASE_URL z Azure>"
   ```
   Adres to session pooler, np. `postgresql://postgres.<projekt>:<hasło>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require`
   (w cudzysłowie!). Gdy gra zdążyła już wystartować na pustej bazie: `sh migrate-from-supabase.sh --force "..."`.
4. **Zdjęcia** (`/home/data` na Azure: `image_cache/` ze zdjęciami wgranymi przez admina, naklejkami itd.):
   pobierz zip z `https://<aplikacja>.scm.azurewebsites.net/api/zip/data/`, rozpakuj do `./data` i:
   ```sh
   sh import-data.sh ./data
   ```
   (Zdjęcia z Wikipedii gra pobiera sama, ale wgranych ręcznie nie odtworzy.)

## Uruchomienie

```sh
docker compose up -d
docker compose ps            # wszystko "healthy" / "running"
docker compose logs -f game  # pierwszy start uzupełnia tabele - może trwać kilka minut
```

Gra: `https://<GAME_DOMAIN>`. Po sprawdzeniu przełącz domenę / poinformuj graczy i usuń aplikację z Azure.

## Supabase Studio (podgląd bazy)

Studio nie jest wystawione do internetu. Z własnego komputera:

```sh
ssh -L 8000:127.0.0.1:8000 <użytkownik>@<serwer>
```

i w przeglądarce `http://localhost:8000` - login `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` z `.env`.
Tabele gry są w schemacie `famechests`. Postgres bezpośrednio (np. DBeaver, przez ten sam tunel z `-L 5432:127.0.0.1:5432`):
użytkownik `postgres.<POOLER_TENANT_ID>`, hasło `POSTGRES_PASSWORD`.

## Na co dzień

```sh
git pull && docker compose build game && docker compose up -d game     # nowa wersja gry (A)
docker compose pull game && docker compose up -d game                  # nowa wersja gry (B)
docker compose logs -f game                                            # logi
docker compose restart game
```

**Kopia zapasowa** (codziennie z crona, trzymaj ją też poza serwerem):

```sh
docker compose exec -T db pg_dump -h localhost -U postgres -d postgres --schema=famechests -Fc \
  > backups/scambox-$(date +%F).dump
```

Odtworzenie: `docker compose stop game`, potem
`docker compose exec -T db pg_restore -h localhost -U postgres -d postgres --clean --if-exists --no-owner < plik.dump`.

## Bezpieczeństwo

- Z internetu widać tylko Caddy (80/443). Supabase, Postgres, pooler i port gry 5000 słuchają **tylko na 127.0.0.1** -
  nie zmieniaj `127.0.0.1:` w `docker-compose.override.yml` (nasz Postgres był już atakowany, gdy stał otwarty).
- Docker omija `ufw` przy publikowanych portach - tym bardziej nie publikuj niczego poza 80/443.
- `.env` (wszystkie hasła) ma prawa `600` i nie trafia do gita. Nie wklejaj go nigdzie.
- Rejestracja w Supabase Auth jest wyłączona (`DISABLE_SIGNUP=true`) - gra ma własne konta.
- Gra działa jako **jeden** proces (Arena, katalog w pamięci) - nie skaluj `game` do kilku kopii.

## Aktualizacja Supabase

`docker-compose.yml` i `volumes/` to kopia `supabase/supabase` -> `docker/` (commit w `SUPABASE_VERSION`). Nowa
wersja: przegraj te pliki z nowszego commita (bez `.env.example` - nasz ma sekcję gry; nowe zmienne dopisz ręcznie),
zrób kopię bazy, `docker compose pull && docker compose up -d`. Zmiany w notatkach wydania:
https://github.com/supabase/supabase/blob/master/docker/CHANGELOG.md
