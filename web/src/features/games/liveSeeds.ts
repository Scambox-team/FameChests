// Losowość gier z nagrodą wydawana przez serwer na raty (server/src/live.rs). Gra jest podzielona na odcinki po `seg` kroków,
// każdy odcinek losuje z własnego ziarna. Start daje ziarna kilku pierwszych odcinków; kolejne przychodzą, gdy przeglądarka
// zatwierdzi zapis klawiszy do początku odcinka (`commit`). Dzięki temu przyszłości gry nie da się znać z góry, a zapis
// jest wysyłany na bieżąco. Rdzeń gry dostaje funkcję `seed(k)`; silnik przed krokiem pyta `canStep(licznik)` i czeka, jeśli
// ziarna jeszcze nie ma (zapas to kilka sekund, więc zwykle nigdy).
import { api } from '../../api/client';

/** Ziarna odcinków dla rdzenia gry */
export type SeedFn = (k: number) => number;

const rand32 = () => (Math.random() * 4294967296) >>> 0;

export class LiveSeeds {
  private seeds: number[];
  private sent = 0;
  private upto = 0;
  private busy: Promise<void> | null = null;
  /** serwer odrzucił odcinek albo zabrakło sieci: gra toczy się dalej na losowych ziarnach, bez nagrody */
  failed = false;

  /** `url` = adres zatwierdzania (null = gra bez serwera), `init` = ziarna ze startu */
  constructor(private url: string | null, init: number[], readonly seg: number, private extra: Record<string, unknown> = {}) {
    this.seeds = init.slice();
  }

  /** Gra bez serwera (start się nie udał): ziarna losowe, bez czekania */
  static local(seg: number) { return new LiveSeeds(null, [], seg); }

  /** czy wynik gry może pójść do serwera */
  get online() { return !!this.url && !this.failed; }

  readonly seed: SeedFn = k => {
    if (!this.online) while (this.seeds.length <= k) this.seeds.push(rand32());
    return this.seeds[k] ?? 0;
  };

  /** Czy znamy ziarno potrzebne do kroku, po którym licznik kroków gry wyniesie `counter + 1` */
  canStep(counter: number) {
    return !this.online || Math.floor((counter + 1) / this.seg) < this.seeds.length;
  }

  /** Po każdym kroku: gdy gra minęła początek nowego odcinka, zatwierdza zapis do tego miejsca (`log`: zdarzenia po `stride`
   *  liczb, pierwsza = numer kroku, rosnąco) */
  pump(counter: number, log: readonly number[], stride = 2) {
    if (!this.online || this.busy) return;
    const upto = Math.floor(counter / this.seg);
    if (upto <= this.upto) return;
    let end = this.sent;
    while (end < log.length && log[end] < upto * this.seg) end += stride;
    const delta = log.slice(this.sent, end);
    this.busy = api<{ seeds: number[] }>(this.url!, { ...this.extra, upto, log: delta })
      .then(r => { this.seeds = r.seeds; this.sent = end; this.upto = upto; })
      .catch(() => { this.failed = true; })
      .finally(() => { this.busy = null; });
  }

  /** Koniec gry: czeka na trwające zatwierdzenie i zwraca resztę zapisu (null = gra bez nagrody) */
  async rest(log: readonly number[]): Promise<number[] | null> {
    while (this.busy) await this.busy;
    return this.online ? log.slice(this.sent) : null;
  }
}

/** Ziarna odcinków w nagraniach botów i testach (to samo co `live::test_seeds` w Rust) */
export function segSeed(base: number, k: number) {
  let a = (base ^ Math.imul(k, 0x9E3779B9)) | 0;
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * 4294967296) >>> 0;
}

/** Start gry z nagrodą: `startUrl` daje `{seeds, seg}` (+ inne pola), zatwierdzanie idzie na `commitUrl`. Gdy start się nie
 *  uda, gra toczy się na losowych ziarnach (`online` = false, bez nagrody). */
export async function startLive<T extends object = object>(startUrl: string, body: unknown, commitUrl: string, seg: number,
  extra: (r: T) => Record<string, unknown> = () => ({})): Promise<{ live: LiveSeeds; data: T | null }> {
  try {
    const r = await api<T & { seeds: number[]; seg: number }>(startUrl, body);
    if (!Array.isArray(r.seeds) || !r.seeds.length) throw new Error('brak ziaren');
    return { live: new LiveSeeds(commitUrl, r.seeds, r.seg || seg, extra(r)), data: r };
  } catch {
    return { live: LiveSeeds.local(seg), data: null };
  }
}
