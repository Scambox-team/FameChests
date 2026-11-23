// Role na serwerze Discord dla graczy z połączonym kontem. Wszystko wynika ze statystyk z gry (/api/bot/links),
// więc bot przy każdej synchronizacji dodaje i zabiera role sam. Grupy są wyłączne: w grupie dostaje się tylko
// pierwszą (najlepszą) pasującą rolę, a grup może być kilka naraz.
//
// Kolejność grup = kolejność ról na liście serwera (od góry): im wyżej, tym bardziej widoczna jest rola.

/** key -> wygląd roli; `hoist` = osobna sekcja na liście członków, `mentionable` = można pingować */
export const ROLE_DEFS = {
  rzulty: { name: '🟡 RZUŁTY', color: 0xffd400, hoist: true, mentionable: true },

  top1: { name: '👑 Top 1', color: 0xf5c542, hoist: true },
  top3: { name: '🥇 Top 3', color: 0xc0c6d0, hoist: true },
  top5: { name: '🥈 Top 5', color: 0xa8b2bd, hoist: true },
  top10: { name: '🏆 Top 10', color: 0xcd7f32, hoist: true },
  top20: { name: '🎖️ Top 20', color: 0xb5651d },
  top50: { name: '🏅 Top 50', color: 0x8e6e53 },
  top100: { name: '📈 Top 100', color: 0x7f8c8d },

  secret: { name: '🔮 Posiadacz Tajnej', color: 0x9b59ff },
  ultra: { name: '🌈 Łowca ULTRA', color: 0xff4fd8 },
  legend: { name: '⭐ Łowca Legend', color: 0xf5c542 },

  millionaire: { name: '💰 Milioner', color: 0x2ecc71 },
  rich: { name: '💵 Bogacz', color: 0x57d38c },

  complete: { name: '🏛️ Kompletna kolekcja', color: 0xe67e22 },
  collector: { name: '📚 Kolekcjoner', color: 0x3498db },
  gatherer: { name: '🃏 Zbieracz', color: 0x5dade2 },

  crazy: { name: '🎰 Szaleniec skrzynek', color: 0xe74c3c },
  opener: { name: '📦 Otwieracz', color: 0xc0804a },

  alchemist: { name: '⚗️ Alchemik', color: 0x1abc9c },
  contractor: { name: '📜 Kontraktor', color: 0xa1887f },

  veteran: { name: '🛡️ Weteran', color: 0x95a5a6 },
  linked: { name: '🔗 Połączony', color: 0x5865f2 },
};

/** [grupa: [klucz, warunek(l)] od najlepszej do najgorszej] - `l` to wpis z /api/bot/links */
const GROUPS = [
  [['rzulty', (l) => l.rzulty === true]],
  [
    ['top1', (l) => l.place === 1],
    ['top3', (l) => l.place <= 3],
    ['top5', (l) => l.place <= 5],
    ['top10', (l) => l.place <= 10],
    ['top20', (l) => l.place <= 20],
    ['top50', (l) => l.place <= 50],
    ['top100', (l) => l.place <= 100],
  ],
  [
    ['secret', (l) => has(l, 'secret')],
    ['ultra', (l) => has(l, 'ultra')],
    ['legend', (l) => has(l, 'gold')],
  ],
  [
    ['millionaire', (l) => l.value >= 1_000_000],
    ['rich', (l) => l.value >= 100_000],
  ],
  [
    ['complete', (l) => l.totalCards > 0 && l.unique >= l.totalCards],
    ['collector', (l) => l.unique >= l.totalCards * 0.5],
    ['gatherer', (l) => l.unique >= l.totalCards * 0.25],
  ],
  [
    ['crazy', (l) => l.opened >= 1000],
    ['opener', (l) => l.opened >= 100],
  ],
  [['alchemist', (l) => l.upgradesWon >= 10]],
  [['contractor', (l) => l.contracts >= 10]],
  [['veteran', (l) => l.ageDays >= 30]],
  [['linked', () => true]],
];

const has = (l, rarity) => Array.isArray(l.rarities) && l.rarities.includes(rarity);

/** Klucze ról, które należą się graczowi. Gracz bez statystyk (poza rankingiem) dostaje tylko "linked". */
export function rolesFor(l) {
  const out = [];
  const ranked = l.place != null;
  for (const group of GROUPS) {
    for (const [key, when] of group) {
      if (key !== 'linked' && !ranked) continue;
      if (when(l)) {
        out.push(key);
        break;
      }
    }
  }
  return out;
}

/** Klucze ról od najwyżej do najniżej na liście serwera */
export const ROLE_ORDER = GROUPS.flatMap((g) => g.map(([k]) => k));


/** Opisy do kanału z zasadami ról (features.js `rules`): [grupa, jak zdobyć, kiedy zniknie] w kolejności GROUPS */
export const ROLE_RULES = [
  ['Wyjątkowa', '🟡 RZUŁTY: wylosowałeś ze skrzynki Jana Pawła II w wariancie Rzulty.', 'Zostaje nawet po sprzedaży karty.'],
  ['Ranking wartości', '👑 Top 1, 🥇 Top 3, 🥈 Top 5, 🏆 Top 10, 🎖️ Top 20, 🏅 Top 50, 📈 Top 100: miejsce w rankingu wartości kolekcji. Dostajesz tylko najlepszą pasującą rolę.', 'Ranking zmienia się cały czas: gdy ktoś Cię wyprzedzi albo sprzedasz karty, spadasz do niższej roli (albo ją tracisz).'],
  ['Najrzadsze karty', '🔮 Posiadacz Tajnej, 🌈 Łowca ULTRA, ⭐ Łowca Legend: masz TERAZ w ekwipunku kartę tej rzadkości (Tajna, ULTRA, Złota).', 'Sprzedaż, kontrakt, ulepszenie, wymiana lub stawka w kasynie zabiera rolę, gdy to była ostatnia taka karta.'],
  ['Majątek', '💰 Milioner (wartość kolekcji od 1 000 000 gr), 💵 Bogacz (od 100 000 gr).', 'Znika, gdy wartość kolekcji spadnie poniżej progu.'],
  ['Kolekcja', '🏛️ Kompletna kolekcja (100% kart), 📚 Kolekcjoner (50%), 🃏 Zbieracz (25%).', 'Nowe karty w grze podnoszą próg: gdy wyjdzie nowa skrzynka, możesz spaść do niższej roli.'],
  ['Skrzynki', '🎰 Szaleniec skrzynek (1000 otwartych skrzynek), 📦 Otwieracz (100).', 'Nie znika (licznik tylko rośnie).'],
  ['Gry', '⚗️ Alchemik (10 udanych ulepszeń), 📜 Kontraktor (10 kontraktów).', 'Nie znika.'],
  ['Staż', '🛡️ Weteran: konto w grze starsze niż 30 dni.', 'Nie znika.'],
  ['Połączenie', '🔗 Połączony: masz połączone konto Discord z grą.', 'Znika po /odlacz.'],
];
