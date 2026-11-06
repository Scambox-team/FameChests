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
| `update.sh` | aktualizacja gry: kopia bazy, nowa wersja, sprawdzenie, w razie błędu powrót (też z crona) |
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
2. Ustaw właściciela gry (`GAME_OWNER_IDS`, sekcja [Kopie zapasowe](#kopie-zapasowe)).
   Z Azure (*Configuration / Environment variables*) przepisz do `.env`:
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

## Aktualizacje

Każdy push do `main` na GitHubie buduje nowy obraz gry (`ghcr.io/scambox-team/famechests:latest`, workflow
`.github/workflows/azure.yml`). Serwer pobiera go sam - z zewnątrz nie trzeba się do niego łączyć (działa za CGNAT).

```sh
sh update.sh            # aktualizuj teraz
sh update.sh --auto     # tylko gdy jest nowa wersja (do crona)
```

Co robi `update.sh`: `git pull` (zmiany w compose i skryptach) -> nowy obraz -> **kopia bazy** (`backups/game/update-*.dump`,
w panelu „Przed aktualizacją”) -> start nowej wersji -> czeka, aż strona logowania odpowie (healthcheck). Jeśli nowa wersja
padnie albo nie odpowie w 10 min, **sam wraca do poprzedniej**, a z crona tej samej zepsutej wersji już nie próbuje
(dopiero następną; ręcznie `sh update.sh` próbuje zawsze). Gdy coś się nie uda, przed zmianą nic nie zostaje ruszone.

**Automatycznie co noc** (`crontab -e`):

```
30 4 * * * cd /home/<użytkownik>/FameChests/deploy/selfhost && sh update.sh --auto >> update.log 2>&1
```

**Skąd obraz** (`GAME_IMAGE` w `.env`):
- `ghcr.io/scambox-team/famechests:latest` - **polecane**: gotowy obraz z CI, aktualizacja trwa kilkanaście sekund.
  Pakiet jest prywatny - raz na serwerze `echo <token> | docker login ghcr.io -u <login-github> --password-stdin`
  (token GitHub *classic* tylko z `read:packages`; albo w ustawieniach pakietu na GitHubie zmień widoczność na publiczną).
- `scambox:local` - budowany na serwerze z repozytorium (`update.sh` robi `git pull` + `docker compose build`):
  bez tokena, ale każda aktualizacja to ~10-15 min budowania i kilka GB RAM.

Powrót dotyczy obrazu gry - zmiany w bazie, które zrobi nowa wersja (nowe tabele i kolumny), zostają; starsza wersja je
pomija. Gdyby trzeba było cofnąć też dane: kopia `update-*.dump` sprzed aktualizacji (sekcja niżej, „Odtworzenie”).

Inne:

```sh
docker compose logs -f game      # logi gry
docker compose restart game
```

Supabase (`docker-compose.yml`) aktualizuje się osobno i rzadko - sekcja „Aktualizacja Supabase” na końcu.

## Kopie zapasowe

Gra sama robi kopię bazy (`pg_dump` schematu gry) **co 24 h** do `./backups/game/` i trzyma 14 najnowszych
(`GAME_BACKUP_EVERY_HOURS`, `GAME_BACKUP_KEEP` w `.env`). Właściciel może też w panelu admina, w zakładce
**Kopie zapasowe**, zrobić kopię od razu i pobrać dowolną z nich.

**Właściciel (owner)** to osobna rola ponad adminem, ustawiana **tylko** w `.env` (`GAME_OWNER_IDS=1,5` - id kont):
- tylko on widzi zakładkę i pobiera kopie (inni admini: 403, gracze i niezalogowani: brak dostępu);
- jego konta nie zmieni żaden inny admin: hasło, odebranie admina, blokada, usunięcie konta i kart;
- nie da się go nadać z panelu ani zmianą w bazie - przejęte konto admina nie dobierze się do kopii;
- każde utworzenie i pobranie kopii zapisuje się w dzienniku adminów.

Id konta (właściciel musi też być adminem w grze):

```sh
docker compose exec -T db psql -h localhost -U postgres -d postgres -c "SELECT id, username FROM famechests.users WHERE is_admin = 1"
```

Wpisz id do `GAME_OWNER_IDS` i `docker compose up -d game`.

**Kopie trzymaj też poza serwerem** (awaria dysku zabiera i bazę, i kopie) - np. co noc z innego komputera:

```sh
rsync -a <użytkownik>@<serwer>:FameChests/deploy/selfhost/backups/game/ ./scambox-kopie/
```

W kopii są hashe haseł i dane graczy - nie wysyłaj jej nikomu i nie wrzucaj do internetu.

**Odtworzenie** z pliku `.dump` (z panelu albo z `backups/game/`) - zastępuje obecne dane gry:

```sh
docker compose stop game
docker compose exec -T db pg_restore -h localhost -U postgres -d postgres --clean --if-exists --no-owner < backups/game/<plik>.dump
docker compose up -d game
```

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
