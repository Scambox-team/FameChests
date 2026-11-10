# Bot Discorda ScamBox

Bot dla serwera społeczności scambox.pl. Działa w Dockerze obok gry i co minutę pobiera z niej stan (`/api/bot/snapshot`).
**Sam niczego nie zakłada na serwerze Discord** (poza rolami, patrz niżej): kanały tworzysz ręcznie i wpisujesz ich ID w `.env`. Kanał bez ID = ta funkcja jest pomijana.

## Funkcje

| Co | Kanał (zmienna w `.env`) |
|---|---|
| Liczba kont i graczy online w nazwach kanałów **głosowych** (`👥 \| Konta: 2 524`, `🟢 \| Online: 37`), odświeżane co 10 min | `DISCORD_CH_ACCOUNTS`, `DISCORD_CH_ONLINE` |
| Ranking (wartość kolekcji, karty, otwarte skrzynki) - jedna wiadomość, którą bot edytuje | `DISCORD_CH_RANKING` |
| Aktualny quest i jego koniec: nowy quest = nowa wiadomość, wykonanie / koniec = edycja | `DISCORD_CH_QUESTS` |
| Eventy: wiadomość na event, edytowana do końca, potem oznaczona jako zakończona | `DISCORD_CH_EVENTS` |
| Skrzynki w sklepie: nowa wiadomość po każdej rotacji (o północy czasu serwera) | `DISCORD_CH_CRATES` |
| Aktualizacje gry: nowy wpis z listy zmian (`patchNotes`), gdy wzrośnie numer wersji. Pierwszy start tylko zapamiętuje obecną | `DISCORD_CH_PATCH` |
| Rzadkie dropy: Legendarna, ULTRA i Tajna karta ze skrzynki, z obrazkiem karty (Tajna bez nazwy i obrazka) | `DISCORD_CH_DROPS` |
| Alert, gdy gra nie odpowiada 3 minuty (ping właściciela serwera, potem komunikat o powrocie) | `DISCORD_CH_ALERTS` (bez niego: wiadomość prywatna do właściciela) |
| Komendy `/profil`, `/ranking`, `/karta`, `/quest`, `/skrzynki`, `/polacz` | `DISCORD_CH_COMMANDS` (gdy ustawiony i `DISCORD_COMMANDS_ONLY=1`, publiczne komendy działają tylko tam) |

Bot pisze do kanałów tekstowych, więc nadaj mu tam uprawnienia: *View Channel*, *Send Messages*, *Embed Links*, *Attach Files* (obrazki kart). Kanały z ogłoszeniami możesz ustawić jako tylko do odczytu dla graczy. Do kanałów głosowych (liczniki) bot potrzebuje *View Channel*, *Connect* i *Manage Channels*.

Czasy w wiadomościach to znaczniki Discorda: każdy widzi je w swojej strefie, a odliczanie ("za 3 godziny") działa samo.

## Uruchomienie (raz)

1. **Aplikacja i token.** https://discord.com/developers/applications → New Application → zakładka *Bot* → *Reset Token* i skopiuj token. Intenty uprzywilejowane zostaw wyłączone.
2. **Zaproszenie.** Link z uprawnieniami (podstaw ID aplikacji z zakładki *General Information*):
   `https://discord.com/oauth2/authorize?client_id=<ID_APLIKACJI>&permissions=269667344&scope=bot+applications.commands`
   Uprawnienia w nim: *View Channels*, *Send Messages*, *Embed Links*, *Attach Files*, *Connect*, *Manage Channels* (zmiana nazw liczników), *Manage Roles* (role za statystyki), *Mention Everyone / roles*. Zakres `applications.commands` jest potrzebny do komend `/...`.
3. **Kanały i ID.** Discord → Ustawienia → Zaawansowane → Tryb dewelopera. Utwórz kanały, a potem prawy klik → *Kopiuj ID kanału* (podobnie ID serwera).
4. **`deploy/selfhost/.env`** (plik jest tylko na serwerze, nie w repozytorium; wzór: `.env.example`):
   ```
   COMPOSE_PROFILES=tunnel,discord        # dopisz "discord" do tego, co już jest
   DISCORD_TOKEN=<token z kroku 1>
   DISCORD_GUILD_ID=<id serwera>
   DISCORD_BOT_GAME_TOKEN=<losowy ciąg min. 16 znaków, np. z: openssl rand -hex 24>
   DISCORD_CH_RANKING=<id kanału>         # i pozostałe DISCORD_CH_*, których chcesz używać
   ```
5. `docker compose up -d --build`. Pierwsze budowanie trwa dłużej (obraz zawiera Chromium do rysowania kart, około 600 MB).

Gra i bot muszą mieć ten sam `DISCORD_BOT_GAME_TOKEN` - to hasło, którym bot pyta grę o dane. Bez niego endpoint w grze nie istnieje (404), a sekcja Discord w ustawieniach gry się nie pokazuje.

**Nie uruchamiaj dwóch botów na jednym tokenie** (np. lokalnego testu obok serwera): oba będą publikować i się wzajemnie rozłączać.

## Komendy

| Komenda | Co robi |
|---|---|
| `/profil gracz` | wartość kolekcji, zebrane karty, otwarte skrzynki, miejsca w rankingu, kontrakty, ulepszacz, najcenniejsze karty; nazwę gracza podpowiada Discord |
| `/ranking wedlug` | top 10 według wartości, kart albo skrzynek |
| `/karta nazwa wariant` | obrazek karty dokładnie jak w grze (CSS wariantu, zdjęcie, napisy) z wartością; nazwę i wariant podpowiada Discord. Tajne i specjalne karty są pomijane |
| `/quest` | aktualny quest |
| `/skrzynki` | skrzynki w sklepie i następna rotacja |
| `/polacz` | kod do połączenia konta Discord z kontem w grze (widoczny tylko dla Ciebie) |

Gracze zablokowani albo ukryci w rankingu przez admina nie są widoczni w `/profil`. Tajne karty pokazują się jako "Tajna karta".

## Karty jako obrazki

Karta w grze to HTML i CSS, więc bot rysuje ją przeglądarką: w kontenerze jest Chromium, który otwiera stronę `/render/card` gry na ukrytym koncie technicznym `__render__` (bez hasła, poza rankingiem, tworzy się przy pierwszej komendzie `/karta`) i robi zrzut samej karty. Obrazek ma ten sam wygląd co w grze, ale animacje wariantów są zatrzymane w jednym kadrze. Gotowe obrazki bot trzyma w pamięci przez 30 minut. Tajne karty to konto techniczne widzi jako zamaskowane, więc nie da się ich w ten sposób podejrzeć.

## Łączenie kont i role

1. Gracz wpisuje na Discordzie `/polacz` i dostaje (tylko dla siebie) kod ważny 10 minut.
2. W grze: **Ustawienia → Discord**, wpisuje kod. Pierwsze połączenie daje **5 000 gr** (raz na konto w grze, także po odłączeniu i ponownym połączeniu; kwota: `DISCORD_REWARD` w `server/src/routes/bot.rs`).
3. W ciągu 5 minut bot nadaje role. Odłączenie w grze zabiera je przy następnej synchronizacji.

**Role to jedyne, co bot zakłada sam**, przy starcie (jeśli roli o danej nazwie nie ma; istniejącą z taką nazwą wykorzysta, więc nic się nie dubluje). Układa je tuż pod swoją rolą. W grupie gracz dostaje tylko najlepszą pasującą rolę, a grup jest kilka:

| Grupa | Role (od najlepszej) |
|---|---|
| Wyjątkowa | **🟡 RZUŁTY**: tylko dla tych, którzy mają w grze kartę **Jan Paweł II w wariancie Rzulty**. Jaskrawożółta, osobna sekcja na liście członków, najwyżej wśród ról bota |
| Ranking wartości | 👑 Top 1, 🥇 Top 3, 🏆 Top 10 (osobne sekcje na liście członków) |
| Najrzadsze karty | 🔮 Posiadacz Tajnej, 🌈 Łowca ULTRA, ⭐ Łowca Legend |
| Majątek | 💰 Milioner (1 000 000 gr wartości kolekcji), 💵 Bogacz (100 000 gr) |
| Kolekcja | 🏛️ Kompletna kolekcja (100% kart), 📚 Kolekcjoner (50%), 🃏 Zbieracz (25%) |
| Skrzynki | 🎰 Szaleniec skrzynek (1000 otwarć), 📦 Otwieracz (100) |
| Gry | ⚗️ Alchemik (10 udanych ulepszeń), 📜 Kontraktor (10 kontraktów) |
| Staż | 🛡️ Weteran (konto starsze niż 30 dni) |
| Połączenie | 🔗 Połączony |

Progi, kolory i nazwy ról są w `src/roles.js`. Gracz poza rankingiem (zablokowany, ukryty przez admina) dostaje tylko `🔗 Połączony`.

## Ping przy nowym queście, evencie i aktualizacji

Utwórz rolę (np. `Powiadomienia`), skopiuj jej id i wpisz w `DISCORD_PING_ROLE_ID`. Gracze nadają ją sobie sami.

## Gdy coś nie działa

```bash
docker compose logs -f discord-bot
```

- `BOT_TOKEN bota różni się od BOT_TOKEN gry`: po zmianie `DISCORD_BOT_GAME_TOKEN` zrestartuj też grę (`docker compose up -d`).
- `Bot nie jest na serwerze ...`: bot nie został zaproszony albo `DISCORD_GUILD_ID` jest zły.
- `brak DISCORD_CH_... w .env - pomijam`: informacja, nie błąd; wpisz ID kanału, jeśli chcesz tę funkcję.
- `nie ma takiego kanału albo bot go nie widzi`: złe ID albo kanał ukryty przed botem.
- `Missing Permissions` / `[role] nie utworzono ról`: nadaj botowi uprawnienia z kroku 2 (*Manage Roles* dla ról, *Manage Channels* + *Connect* dla liczników). Rola bota musi stać wyżej niż role, którymi zarządza.
- Usunięcie wiadomości bota jest bezpieczne: przy następnym odświeżeniu wyśle ją od nowa.
- Wyczyszczenie stanu bota (zapomni, które wiadomości edytował): `docker compose down discord-bot && docker volume rm supabase_discord-bot-data`.
