# ScamBox na własnym serwerze (Docker + self-hosted Supabase)

Cała gra w jednym `docker compose`: serwer gry (obraz z `server/Dockerfile`), Supabase z Postgresem 17
(oficjalny zestaw self-hosted) i HTTPS - **Cloudflare Tunnel** (domyślnie, działa za CGNAT) albo Caddy.

```
gracz ─HTTPS─> Cloudflare ═tunel (wychodzący z serwera)═> cloudflared ─> gra (scambox) ─> Postgres (supabase-db)
                                                                                            ^
SSH tunel ──127.0.0.1:8000──> Supabase Studio / API ─────────────────────────────────────────┘ (z internetu niewidoczne)
```

HTTPS wybiera `COMPOSE_PROFILES` w `.env`:
- `tunnel` - **Cloudflare Tunnel**: serwer sam łączy się z Cloudflare, na routerze nic się nie otwiera (CGNAT nie
  przeszkadza). Domena w Cloudflare, token tunelu w `CLOUDFLARE_TUNNEL_TOKEN`, trasa w panelu: sekcja
  [Cloudflare Tunnel](#cloudflare-tunnel).
- `caddy` - Caddy z certyfikatem Let's Encrypt: publiczne IP, rekord A domeny na serwer, otwarte porty 80 i 443,
  domena w `GAME_DOMAIN`.

| Plik | Co |
|---|---|
| `docker-compose.yml` | oficjalny plik Supabase - **bez zmian** (wersja: `SUPABASE_VERSION`) |
| `docker-compose.override.yml` | gra + cloudflared / Caddy, porty Supabase zamknięte na 127.0.0.1 (docker compose dokleja go sam) |
| `.env.example` | wzór ustawień; `setup.sh` robi z niego `.env` z losowymi hasłami |
| `migrate-from-supabase.sh` | dane graczy z Supabase w chmurze -> lokalna baza |
| `import-data.sh` | zdjęcia (`DATA_DIR` z Azure) -> wolumen gry |
| `update.sh` | aktualizacja gry: kopia bazy, nowa wersja, sprawdzenie, w razie błędu powrót (też z crona) |
| `caddy/Caddyfile` | HTTPS dla domeny gry (tylko wariant `caddy`) |

## Wymagania

- Linux z Dockerem (Docker Engine + plugin `docker compose` v2.24+), `git`, `openssl`
- ~4 GB RAM wolne (sam Supabase to kilkanaście kontenerów), kilka GB na dysku
- domena w Cloudflare (wariant `tunnel`, nic nie otwierasz) albo publiczne IP i otwarte porty **80 i 443** (wariant
  `caddy`). Żadnych innych portów nie otwieraj.

## Instalacja

```sh
git clone https://github.com/Scambox-team/FameChests.git
cd FameChests/deploy/selfhost
sh setup.sh                  # .env z losowymi hasłami i kluczami
nano .env                    # CLOUDFLARE_TUNNEL_TOKEN, GAME_SECRET_KEY, GAME_OWNER_IDS, GAME_OPERATOR_NAME, GAME_CONTACT_EMAIL
```

`.env` z wcześniejszej instalacji (sprzed tunelu)? Dopisz do niego `COMPOSE_PROFILES=tunnel` i `CLOUDFLARE_TUNNEL_TOKEN=...`
(albo `COMPOSE_PROFILES=caddy`, jeśli zostajesz przy Caddy).

## Cloudflare Tunnel

1. Domena w Cloudflare (serwery DNS u rejestratora przestawione na Cloudflare).
2. Zero Trust -> Networks -> Tunnels -> *Create a tunnel* (Cloudflared) -> przy instalacji wybierz **Docker** i skopiuj
   token (wszystko po `--token `) do `CLOUDFLARE_TUNNEL_TOKEN` w `.env`. Nie uruchamiaj pokazanego polecenia -
   `cloudflared` startuje razem z resztą (`docker compose up -d`).
3. W tunelu -> **Routes** -> *Add route* -> *Published application*: domena (np. `scambox.pl`, puste Subdomain),
   **Service URL `http://game:8000`**. Cloudflare sam założy rekord DNS - wcześniej usuń rekordy A tej domeny
   wskazujące gdzie indziej (np. stary hosting).
4. Po `docker compose up -d` tunel w panelu ma status **Healthy**. Logi: `docker compose logs -f cloudflared`.

Wyciekł token? W tunelu *Rotate token*, nowy do `.env`, `docker compose up -d cloudflared`.

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

## Email i odzyskiwanie hasła

Konto w grze to **email + nazwa gracza + hasło**. Email i hasło trzyma Supabase Auth (kontener `auth`), a nazwa i
cała gra zostają w tabelach gry (powiązanie: tabela `user_auth`). Gracz zapomniał hasła: na stronie logowania
„Nie pamiętasz hasła?” -> mail z linkiem -> nowe hasło. Rejestracja wymaga kliknięcia w link potwierdzający z maila.

Potrzebny jest **prawdziwy serwer SMTP** (sam Docker maili nie wyśle, a własny serwer pocztowy prawie zawsze ląduje w
spamie). Najprościej:

| Dostawca | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` / `SMTP_PASS` |
|---|---|---|---|
| Gmail | `smtp.gmail.com` | `587` | adres gmail / [hasło aplikacji](https://myaccount.google.com/apppasswords) (nie zwykłe hasło) |
| Brevo, Resend, Mailgun... | z panelu dostawcy | `587` lub `465` | z panelu dostawcy |

W `.env` ustaw: `GAME_PUBLIC_URL` (adres gry z `https://`, np. `https://scambox.pl` - tu wracają linki z maili),
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL` (adres nadawcy; u większości dostawców
zweryfikowany) i opcjonalnie `SMTP_SENDER_NAME`. Potem `docker compose up -d`.
Przy `.env` z wcześniejszej instalacji dopisz te zmienne ręcznie (wzór: `.env.example`); bez `GAME_PUBLIC_URL`
`docker compose` zatrzyma się z komunikatem.

Wygląd maili (potwierdzenie konta, nowe hasło, zmiana emaila) to gotowy HTML w `server/email/`, w kolorach gry. Gra
sama go podaje pod `/email/<nazwa>.html`, a `auth` pobiera przez sieć Dockera (`GOTRUE_MAILER_TEMPLATES_*` w
`docker-compose.override.yml`) - po zmianie pliku wystarczy zbudować nowy obraz gry; gdy `game` nie odpowiada,
GoTrue wysyła swój zwykły, brzydszy mail. Na Supabase w chmurze wklej te pliki w Authentication -> Email Templates
(pola `{{ .ConfirmationURL }}` zostają). Lokalnie przed wysyłką można je otworzyć w przeglądarce: `http://127.0.0.1:5000/email/recovery.html`.

Sprawdzenie: załóż konto na stronie gry, mail z linkiem powinien przyjść w minutę (sprawdź też spam). Nie przychodzi?
`docker compose logs auth` pokaże błąd SMTP (zły login/hasło, port, niezweryfikowany nadawca).
Na czas testów bez poczty ustaw `ENABLE_EMAIL_AUTOCONFIRM=true` - konto jest wtedy od razu potwierdzone (odzyskiwanie
hasła nadal potrzebuje SMTP).

**Starzy gracze** (konta sprzed emaili) logują się jak dotąd nazwą i hasłem, a email dopisują sami: profil ->
**Email** (wpisują adres i obecne hasło, potwierdzają linkiem z maila). Bez emaila nie odzyskają hasła; mogą też
poprosić admina o zmianę hasła w panelu. Zalogowanie się nowym sposobem kasuje stary hash hasła z bazy gry.

Admin zmieniający hasło albo usuwający gracza w panelu zmienia/usuwa też jego konto w Supabase Auth. Ręczne
usunięcie użytkownika w Supabase Studio nie usuwa gracza z gry - kasuj zawsze z panelu admina.

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

Na serwerze `curl -I http://127.0.0.1:5000/login` -> `200` = gra działa. Potem z internetu `https://<domena>`
(przy tunelu: dopiero po dodaniu trasy w Cloudflare).

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

Pierwsze zarejestrowane konto **nie jest** już adminem z automatu. Właściciel dostaje uprawnienia admina przy starcie gry (potem może nadawać admina innym w panelu), więc: załóż konto, sprawdź jego id, wpisz je w `GAME_OWNER_IDS` i zrestartuj grę (`docker compose up -d game`). Id konta:

```sh
docker compose exec -T db psql -h localhost -U postgres -d postgres -c "SELECT id, username FROM famechests.users ORDER BY id"
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

- Przy tunelu z internetu nie widać żadnego portu serwera, przy Caddy tylko 80/443. Supabase, Postgres, pooler i port
  gry 5000 słuchają **tylko na 127.0.0.1** - nie zmieniaj `127.0.0.1:` w `docker-compose.override.yml` (nasz Postgres
  był już atakowany, gdy stał otwarty).
- Docker omija `ufw` przy publikowanych portach - tym bardziej nie publikuj niczego więcej.
- `CLOUDFLARE_TUNNEL_TOKEN` to hasło do domeny: kto go ma, podepnie własny serwer pod `scambox.pl`.
- `.env` (wszystkie hasła) ma prawa `600` i nie trafia do gita. Nie wklejaj go nigdzie.
- Rejestracja w Supabase Auth jest wyłączona (`DISABLE_SIGNUP=true`) - gra ma własne konta.
- Gra działa jako **jeden** proces (Arena, katalog w pamięci) - nie skaluj `game` do kilku kopii.

## Aktualizacja Supabase

`docker-compose.yml` i `volumes/` to kopia `supabase/supabase` -> `docker/` (commit w `SUPABASE_VERSION`). Nowa
wersja: przegraj te pliki z nowszego commita (bez `.env.example` - nasz ma sekcję gry; nowe zmienne dopisz ręcznie),
zrób kopię bazy, `docker compose pull && docker compose up -d`. Zmiany w notatkach wydania:
https://github.com/supabase/supabase/blob/master/docker/CHANGELOG.md
