# Projektowanie wariantu karty: wymiary i konstrukcja

Wymiary poniżej zmierzono na działającej grze (komponent `cardHTML` w `web/src/cards/cardHtml.ts`, style w `web/src/cards/css/base.css` i `cards2.css`). Szablon do rysowania: [szablon-karty.svg](szablon-karty.svg).

## 1. Płótno

- Proporcje karty to **63 : 88** (jak karta Pokemon, 63 x 88 mm), `aspect-ratio: 63 / 88`.
- Do rysowania przyjmij **630 x 880 px** (10 px na mm). Do eksportu lepiej **1260 x 1760 px** (2x), bo kartę pokazuje się też powiększoną w podglądzie (do ok. 400 px szerokości na ekranie, więcej na ekranach o dużej gęstości).
- Zaokrąglenie rogów karty: `4,5% x 3,2%` (czyli 28,4 x 28,2 px na 630 x 880). Wnętrze karty ma `3% x 2,2%` (17,5 x 18,4 px).
- Wszystko w karcie skaluje się z jej szerokością (jednostka `cqw`, 1% szerokości karty). Rozmiar tekstu to `5,7cqw` (33,3 px na 630). Dlatego **projektuj w procentach albo w siatce 630 x 880**, nigdy w pikselach ekranu.

## 2. Układ zwykłej karty (630 x 880 px, współrzędne od lewego górnego rogu)

| Element | Klasa | x | y | szer. | wys. |
|---|---|---|---|---|---|
| Ramka (kolor lub gradient `--frame`) | `.card` | 0 | 0 | 630 | 880 |
| Wnętrze (tło `--inner`) | `.card-inner` | 22,6 | 22,6 | 584,7 | 834,7 |
| Nagłówek: nazwa, HP, ikona typu | `.card-head` | 51,9 | 46,0 | 526,3 | 40,6 |
| Zdjęcie (z obwódką 8,7 px) | `.card-photo` | 51,9 | 102,4 | 526,3 | 505,2 |
| Widoczny obraz zdjęcia | `img` | 60,6 | 111,1 | 508,9 | 487,8 |
| Podpis „typ · skrzynka” | `.card-sub` | 41,4 | 620,7 | 547,3 | 22,4 |
| Zdolność (1 sztuka) | `.card-attack` | 51,9 | 662,5 | 526,3 | 76,4 |
| Słabość / odporność / wycofanie | `.card-stats` | 51,9 | 754,6 | 526,3 | 46,2 |
| Stopka: rzadkość, numer, wartość | `.card-foot` | 51,9 | 816,6 | 526,3 | 23,2 |

Uwagi:
- Zdjęcie jest **prawie kwadratowe**: proporcja `1 : 0,96` (526 x 505). Grafika, która ma wypełnić zdjęcie, powinna mieć tę proporcję. Obraz jest przycinany (`object-fit: cover`, punkt ostrości 50% 18%, więc twarz idzie w górę).
- Przy 2 lub 3 zdolnościach blok zdolności rośnie w górę, a teksty się zmniejszają (klasy `.two-atk`, `.atk-3`). Nie umieszczaj ważnych elementów tła w pasie y 640-840 (są tam panele z tekstem).
- Liczba zdolności jest zmienna, więc **nie zakładaj stałych współrzędnych dolnych paneli**.
- Wariant „Wizytówka” czy „Dowód osobisty” zmienia układ (obrócona karta), ale zwykłe warianty mają się różnić **wyglądem, nie proporcjami**: zdjęcie zawsze prostokątne, układ jak wyżej.

## 3. Tajna karta (inny układ)

Karta w rzadkości „Tajna” ma pełnoekranowe zdjęcie (`.sc-art` rozciągnięte na całą kartę, 630 x 880), a napisy leżą na nim:
- nagłówek `.sc-top`: od góry 4% (35 px), po bokach 6% (37,8 px),
- panel `.sc-panel` ze zdolnościami i stopką: po bokach 6%, od dołu 5% (44 px),
- aureola `.sc-halo` wyśrodkowana na (50%, 27%), szerokość 92%,
- cienka ramka wewnętrzna `.sc-frame` na `inset: 3,4%`, złota obwódka `.sc-border` 2,2%,
- plakietka wariantu u tajnej karty jest po lewej, na 13% wysokości.

Wariant, który ma działać także na tajnej karcie, trzeba zaprojektować dla obu układów (w CSS reguły piszemy podwójnie: `.card.v-X ...` i `.r-secret.v-X ...`).

## 4. Warstwy od spodu do góry

1. **Ramka** `.card`: zmienna CSS `--frame` (kolor, gradient, obrazek). Złote, ULTRA i część wariantów rysują ramkę w `.card::before`, żeby animacja nie przerysowywała całej karty.
2. **Tło wnętrza** `.card-inner`: zmienna `--inner` albo własne `background`.
3. **Warstwa tła** `.vx-bg` (`z-index: 0`): obrazki i animacje za napisami, **pod zdjęciem**. Widać ją tylko w wolnych miejscach (nad zdjęciem, po bokach, między panelami). Tu idą np. miasto, niebo, wzory.
4. **Napisy i zdjęcie** (nagłówek, `.card-photo`, podpis, zdolności, statystyki, stopka). Panele pod zdjęciem mogą mieć półprzezroczyste tło, żeby było widać warstwę 3.
5. **Warstwa na zdjęciu** `.vx-photo` (`z-index: 1` wewnątrz `.card-photo`): nakładki, ramki, pieczątki, filtry. Leży **dokładnie na zdjęciu** (526 x 505), przycięta do niego.
6. **Warstwa nad kartą** `.vx-deco` (`z-index: 3`): dekoracje wystające poza zdjęcie, rogi, ramki, naklejki, snopy światła. Przykryje wszystko pod sobą.
7. **Plakietka wariantu** `.var-tag` (`z-index: 4`): mały napis z nazwą wariantu, domyślnie na 34% wysokości, po prawej (prawa krawędź 7% od brzegu). Zaprojektuj tak, żeby jej nie zasłaniać ważnym elementem albo przesuń ją w CSS.
8. **Połysk** `.shine`: biały blask pod kursorem (`mix-blend-mode: soft-light`) nad całością, to samo dla każdego wariantu.

Dodatkowo: pasek nad nazwą (`variantTop`, np. terminal, napis WANTED) i tekst zamiast „typ · skrzynka” (`variantSub`).

## 5. Czym można rysować

Są dwie drogi:

**A. Kreator w panelu admina (bez kodu)**: `/designer` (admin → „Kreator wariantów”). Warstwy: ramka, tło (kolory, wzory, ruch), zdjęcie (filtr, obwódka), napisy (czcionka, kolory), plakietka, efekty. Z podglądem na żywo. Nowy wariant jest wyłączony, włączasz go na `/variants`.

**B. Własna grafika**
- **Naklejki** (`/stickers`): wgrywasz **PNG z przezroczystością** (najlepiej kwadratowe lub w proporcji elementu, 512-1024 px dłuższy bok). W panelu ustawiasz środek (x, y w % karty), szerokość (% karty), obrót, odbicie i ruch. Naklejka jest taka sama na każdej karcie w wariancie. Najwyżej 30 naklejek na wariant. Mogą leżeć nad kartą albo pod zdjęciem (tryb „Pod zdjęciem”).
- **Własne tło / ramka / nakładka w kodzie**: grafika jako plik w `static/img/` albo jako SVG zapisany w CSS jako data URL (tak są zrobione większość wariantów, np. `--wd-oak`). Dla tła i ramki rysuj **całą kartę 630 x 880** z przezroczystym otworem na zdjęcie; dla nakładki na zdjęcie rysuj **526 x 505**.
- **Zdjęcie wariantu**: w edycji karty można wgrać osobne zdjęcie dla wariantu (np. Anime), proporcja `1 : 0,96`.
- Format: PNG lub WebP z kanałem alfa (serwer zapisuje wszystko jako WebP), SVG dla grafiki wektorowej. Bez znaków towarowych, logo marek i godła RP.

## 6. Z czego składa się wariant w kodzie

Wariant wymaga:
1. Wpisu w `server/data/game.json` w `variants` (`name`, `chance`, `mult`, `off: true`, `desc`; opcjonalnie `stickers`, `texts`, `photo`).
2. Wyglądu w `web/src/cards/css/cards2.css` (`.card.v-<id>`: `--frame`, `--inner`, kolory panelu, filtr zdjęcia `.card.v-<id> .card-photo > img, .r-secret.v-<id> .sc-art img`, ramka tajnej `.r-secret.v-<id> .sc-border`).
3. Warstw w `cardHtml.ts`: `VX_BG` (tło), `VX_PHOTO` (na zdjęciu), `VX_DECO` (nad kartą), opcjonalnie `variantTop` i `variantSub`.
4. Małych kafelków: `.pick.v-<id>` (lista kart) i `.avv-<id>` (avatary).
5. Etykiety plakietki w `VARIANT_TAGS`.
6. Tłumaczenia nazwy i opisu w `web/src/i18n/en.ts`.

Gotowe wzory do skopiowania: Drewniany `wood` (prosty, bez animacji), Polaroid `polaroid`, Wanted `wanted`, Cyfrowa `digital`.

## 7. Zasady, o których łatwo zapomnieć

- Animuj tylko `transform` i `opacity` (nie `background-position` dużych warstw), bo gracze mają tysiące kart na liście.
- Nie dawaj `mix-blend-mode` ani filtrów SVG nad `<video>`.
- Zdjęcie ma zostać prostokątne (najwyżej zaokrąglone rogi), bez kół i owali.
- Ważne elementy graficzne nie powinny zależeć od liczby zdolności (patrz punkt 2).
- Nowe warianty są zwykłe (bez `"exclusive"`), chyba że ustalimy inaczej, i domyślnie wyłączone.
