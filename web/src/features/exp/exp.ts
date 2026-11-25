// EXP i levele konta (server/src/exp.rs). Serwer podaje postęp w /api/me (`exp`) i nagłówkiem X-Exp po zapytaniach, które dały EXP.
// Pasek nie zdradza wyniku gry: odświeża się dopiero po animacji (`animBusy`), tak samo jak okienko „Nowy level” i „+N EXP” -
// premia za wygraną w kasynie albo level, który wskoczył przy wylosowaniu, nie mogą wyprzedzić ekranu z wynikiem.
import { api } from '../../api/client';
import { S, touch } from '../../game/store';
import { animBusy } from '../achievements/popups';
import { showLevelUps, type LevelUp } from './levelup';

export interface Badge { year: number; tier: number; name: string; count: number }
export interface ExpProgress {
  exp: number; level: number; into: number; need: number; max: boolean; maxLevel: number; unseen: number; badge: Badge | null;
  /** ile razy gracz skończył cykl 1-100 */
  cycle: number;
  /** duże nagrody czekające na wybór 2 z 4 */
  choices: number;
}

const POLL = 400, MAX_WAIT = 90000;
const q = { gain: 0, since: 0, timer: 0 as any, busy: false, seq: 0, prompted: 0 };

/** Pasek EXP w górnym pasku czyta S.exp; „+N EXP” przy pasku: S.expGain */
export const progress = (): ExpProgress | null => S.exp ?? null;

function schedule() {
  if (q.timer) return;
  q.timer = setTimeout(() => { q.timer = 0; tick(); }, POLL);
}

function tick() {
  if (!q.since) q.since = Date.now();
  if (animBusy() && Date.now() - q.since < MAX_WAIT) return schedule();
  void flush();
}

async function flush() {
  if (q.busy) return;
  q.busy = true;
  const header = q.gain;
  q.gain = 0;
  q.since = 0;
  try {
    const before = S.exp?.exp ?? 0;
    const p = await api<ExpProgress>('/api/exp/progress');
    apply(p, header || Math.max(0, p.exp - before));
    let me = p;
    if (p.unseen > 0) {
      const d = await api<{ list: LevelUp[]; me: ExpProgress }>('/api/exp/pop', {});
      apply(d.me, 0);
      showLevelUps(d.list);
      me = d.me;
    }
    // duża nagroda do wybrania: okno otwiera się samo raz na nową nagrodę (potem z paska / strony Poziom)
    if (me.choices > q.prompted) openChoices();
    q.prompted = me.choices;
  } catch { /* pasek to dodatek: następne zapytanie spróbuje jeszcze raz */ }
  q.busy = false;
}

function apply(p: ExpProgress, gained: number) {
  S.exp = p;
  if (gained > 0) {
    const id = ++q.seq;
    S.expGain = { n: gained, id };
    setTimeout(() => { if (S.expGain?.id === id) { S.expGain = null; touch(); } }, 2600);
  }
  touch();
}

/** Okno wyboru dużej nagrody (2 z 4); renderuje je `ExpChoiceHost` */
export function openChoices() {
  S.expChoice = true;
  touch();
}

/** Nagłówek X-Exp: zapytanie dało `n` EXP (pasek odświeży się po animacji wyniku) */
export function expHeader(n: number) {
  if (n > 0) q.gain += n;
  schedule();
}

/** Odpowiedź /api/me: pierwszy raz od razu, potem tylko gdy EXP się zmienił (np. wymiana, rynek, quest) albo są nowe levele */
export function noteExp(e: ExpProgress | undefined) {
  if (!e) return;
  if (!S.exp) { S.exp = e; touch(); }
  if (e.exp !== S.exp.exp || e.unseen > 0 || e.level !== S.exp.level || e.choices !== S.exp.choices || e.choices > q.prompted) schedule();
}
