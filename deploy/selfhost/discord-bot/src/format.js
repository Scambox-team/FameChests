// Formatowanie liczb, czasu i sum kontrolnych dla wiadomości bota

const nf = new Intl.NumberFormat('pl-PL');

export const num = (n) => nf.format(Math.round(n ?? 0));

/** Grosze gry, np. 12500 -> "12 500 gr" */
export const gr = (n) => `${num(n)} gr`;

/** Znacznik czasu Discorda: pokazuje czas w strefie czytelnika i sam odlicza ("za 3 godziny") */
export const rel = (sec) => `<t:${Math.floor(sec)}:R>`;
export const full = (sec) => `<t:${Math.floor(sec)}:f>`;

/** Data RRRR-MM-DD z gry -> 24.12.2026 */
export const day = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s ?? '';
};

/** Szansa 0-1 -> "2,5%" */
export const pct = (x) => `${(x * 100).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%`;

export const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Krótki odcisk treści: wiadomość edytujemy tylko, gdy coś się zmieniło */
export const stamp = (v) => JSON.stringify(v);
