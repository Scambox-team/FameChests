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
  top10: { name: '🏆 Top 10', color: 0xcd7f32, hoist: true },

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
    ['top10', (l) => l.place <= 10],
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

