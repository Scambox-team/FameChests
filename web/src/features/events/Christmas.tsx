import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Gift, Info, Search, Trash2, TreePine } from 'lucide-react';
import { api } from '../../api/client';
import { PickTile } from '../../cards/PickTile';
import { cardValue, person, variantName } from '../../game/rules';
import { syncInventory } from '../../game/session';
import { S, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import s from './christmas.module.css';

// Wspólna choinka eventu świątecznego (server/src/routes/christmas.rs): codziennie jedna karta na gracza, powieszone karty
// wracają dopiero po evencie (do końca dnia można zdjąć), na koniec losowe karty za 70% wartości.
interface Hung { item: number; person: string; variant: string; day: string; value: number; canTake: boolean }
interface Reward { person: string; variant: string; name: string; variantName: string; value: number; special?: boolean; from?: string }
export interface TreeResult { hung: number; value: number; budget: number; rewards: Reward[]; rewardsValue: number; pool: Reward[]; poolValue: number }
interface Tree {
  available: boolean; adminPreview?: boolean; testDate?: boolean;
  event?: { name: string; start: string; end: string };
  today: string; running: boolean; day: number; days: number; endsAt: number; sharePct: number; settled: boolean;
  pool: { variant: string; name: string }[];
  tree: { cards: number; players: number; value: number };
  mine: { count: number; value: number; budget: number; hungToday: boolean; hung: Hung[] };
  cards: { person: string; variant: string; user: string; day: string }[]; cardsShown: number;
  result: TreeResult | null;
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });

/** Czas do końca dnia: „5 godz. 12 min” */
function left(endsAt: number, now: number) {
  const m = Math.max(0, Math.floor((endsAt - now) / 60));
  return m >= 60 ? `${Math.floor(m / 60)} godz. ${m % 60} min` : `${m} min`;
}

// ---------------------------------------------------------------- rysunek choinki

const COLORS = ['#e8b64a', '#d63a3a', '#3a7bd6', '#f4f0e6', '#c24fc4', '#47c26b', '#ff8a3d'];
const TRIS: [number, number][][] = [[[150, 40], [78, 142], [222, 142]], [[150, 96], [58, 222], [242, 222]], [[150, 166], [36, 312], [264, 312]]];

/** Stałe położenia bombek wewnątrz drzewa (ta sama kolejność za każdym razem, więc nowe karty dokładają kolejne) */
const SPOTS = (() => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const pts: { x: number; y: number; c: string; r: number }[] = [];
  let guard = 0;
  while (pts.length < 160 && guard++ < 20000) {
    const t = TRIS[Math.floor(rnd() * 3)];
    const [a, b, c] = t;
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const x = a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]);
    const y = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
    if (y < 70 || pts.some(p => (p.x - x) ** 2 + (p.y - y) ** 2 < 150)) continue;
    pts.push({ x, y, c: COLORS[pts.length % COLORS.length], r: 4.6 + rnd() * 2 });
  }
  return pts;
})();

const LIGHT_COLORS = ['#ff3b3b', '#ffd60a', '#30d158', '#4aa8ff', '#ff9f0a', '#d77bff'];
const GARLANDS: [number, number, number, number, number, number][] = [[92, 128, 150, 152, 208, 128], [72, 208, 150, 240, 228, 208], [52, 296, 150, 334, 248, 296]];
/** Punkt na krzywej Béziera drugiego stopnia (łańcuch choinkowy) */
const bez = (g: number[], t: number): [number, number] => [(1 - t) ** 2 * g[0] + 2 * (1 - t) * t * g[2] + t * t * g[4], (1 - t) ** 2 * g[1] + 2 * (1 - t) * t * g[3] + t * t * g[5]];
const LIGHTS = GARLANDS.flatMap((g, gi) => Array.from({ length: 6 + gi * 2 }, (_, k) => ({ at: bez(g, (k + .5) / (6 + gi * 2)), c: LIGHT_COLORS[(k + gi * 2) % LIGHT_COLORS.length], d: -((k * .41 + gi * .3) % 1.6) })));
/** Kołnierz ze śniegu wzdłuż dolnej krawędzi piętra: faliste zaspy */
const snowEdge = (x1: number, x2: number, y: number) => {
  let d = `M${x1} ${y}`;
  const n = Math.round((x2 - x1) / 16);
  for (let i = 0; i < n; i++) d += ` Q${x1 + (i + .5) * (x2 - x1) / n} ${y + (i % 2 ? 9 : 5)} ${x1 + (i + 1) * (x2 - x1) / n} ${y}`;
  return d;
};
const GIFTS: [number, number, number, number, string, string][] = [[46, 330, 38, 30, '#e8283a', '#ffd60a'], [86, 340, 28, 20, '#2f86ee', '#fff'], [192, 326, 40, 34, '#1faa5c', '#ffd60a'], [230, 342, 30, 20, '#a65bd6', '#ffe9a8']];

function TreeArt({ cards }: { cards: number }) {
  const shown = Math.min(cards, SPOTS.length);
  return (
    <svg className={s.art} viewBox="0 0 300 382" role="img" aria-label={`Choinka z ${cards} powieszonymi kartami`}>
      <ellipse cx="150" cy="366" rx="146" ry="18" fill="#fff" />
      <path d="M0 382 V362 Q40 350 80 360 T160 358 T240 360 T300 356 V382Z" fill="#eaf4ff" />
      <rect x="132" y="308" width="36" height="46" rx="3" fill="#7a4a24" stroke="#4a2a12" strokeWidth="2" />
      {TRIS.map((t, i) => <polygon key={i} points={t.map(p => p.join(',')).join(' ')} fill={['#26b556', '#1fa34b', '#168a3d'][i]} stroke="#0b5a28" strokeWidth="2.4" strokeLinejoin="round" />)}
      {[[78, 222, 142], [58, 242, 222], [36, 264, 312]].map(([x1, x2, y], i) => <path key={i} d={snowEdge(x1, x2, y)} fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".96" />)}
      <path d="M92 128 Q150 152 208 128 M72 208 Q150 240 228 208 M52 296 Q150 334 248 296" fill="none" stroke="#ffd23d" strokeWidth="3.2" strokeDasharray="1 7" strokeLinecap="round" />
      {LIGHTS.map((l, i) => <circle key={i} className={s.light} cx={l.at[0]} cy={l.at[1]} r="3.6" fill={l.c} style={{ animationDelay: `${l.d}s`, color: l.c }} />)}
      {GIFTS.map(([x, y, w, h, c, r], i) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={h} rx="3" fill={c} stroke="#00000044" strokeWidth="1.2" />
          <rect x={x + w / 2 - 3.5} y={y} width="7" height={h} fill={r} /><rect x={x} y={y + h * .32} width={w} height="6" fill={r} />
          <path d={`M${x + w / 2} ${y} c-12 -12 -17 1 0 0 c17 1 12 -12 0 0z`} fill={r} stroke="#00000033" strokeWidth=".8" />
        </g>
      ))}
      <g className={s.starWrap}><circle cx="150" cy="26" r="26" fill="#ffd54a" opacity=".28" />
        <polygon className={s.star} points="150,4 157,22 176,22 161,34 167,52 150,41 133,52 139,34 124,22 143,22" fill="#ffd54a" stroke="#d99a00" strokeWidth="1.6" strokeLinejoin="round" /></g>
      {SPOTS.slice(0, shown).map((p, i) => (
        <g key={i} className={s.bauble} style={{ animationDelay: `${(i % 9) * .35}s`}}>
          <line x1={p.x} y1={p.y - p.r - 4} x2={p.x} y2={p.y - p.r} stroke="#e8e8e8" strokeWidth="1" />
          <circle cx={p.x} cy={p.y} r={p.r} fill={p.c} stroke="#00000055" strokeWidth=".8" />
          <circle cx={p.x - p.r / 3} cy={p.y - p.r / 3} r={p.r / 3.2} fill="#ffffffaa" />
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- okno choinki

export function ChristmasDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['christmas'], queryFn: () => api<Tree>('/api/christmas'), refetchInterval: 20_000 });
  const [pick, setPick] = useState(false);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 30_000); return () => clearInterval(t); }, []);

  const act = async (path: string, item: number, ok: string) => {
    setBusy(true);
    try {
      const t = await api<Tree>(path, { item });
      qc.setQueryData(['christmas'], t);
      Sound.coin(1);
      toast(ok);
      await syncInventory(null, true);
    } catch (e: any) { Sound.error(); toast(e.message, true); }
    setBusy(false);
  };

  if (error) return <Modal title="Choinka" onClose={onClose}><p className="muted">{(error as Error).message}</p></Modal>;
  if (!data) return <Modal title="Choinka" onClose={onClose}><p className="muted">Ładowanie</p></Modal>;
  if (!data.available || !data.event) return <Modal title="Choinka" onClose={onClose}><p className="muted">Choinka nie jest teraz dostępna.</p></Modal>;
  const d = data as Tree & { event: NonNullable<Tree["event"]> };
  const hungToday = d.mine.hung.find(h => h.canTake);
  const specials = Object.values(S.cfg.people).filter((p: any) => p.source === 'tree').map((p: any) => p.name as string);   // karta specjalna z choinki (specialSources.tree)

  return (
    <Modal title="Wspólna choinka" onClose={onClose} wide>
      {d.adminPreview && <p className={s.admin}><Info size={15} aria-hidden="true" /> Podgląd dla adminów: dla graczy choinka jest wyłączona.{d.testDate && ' Działa data testowa z panelu.'}</p>}
      <div className={s.top}>
        <button type="button" className={s.treeBtn} onClick={() => { Sound.click(); setAll(true); }} aria-label="Pokaż powieszone karty">
          <TreeArt cards={d.tree.cards} />
          <span className={s.treeHint}><Search size={14} aria-hidden="true" /> Kliknij choinkę, żeby zobaczyć karty</span>
        </button>
        <div className={s.side}>
          <div className={s.stats}>
            <div><b>{d.tree.cards}</b><span>kart na choince</span></div>
            <div><b>{d.tree.players}</b><span>{d.tree.players === 1 ? 'gracz' : 'graczy'}</span></div>
            <div><b>{fmt(d.tree.value)}</b><span>wartość kart</span></div>
          </div>
          {d.running && !d.settled && <p className="muted small"><Clock size={14} aria-hidden="true" /> Dzień {d.day} z {d.days}.{!d.testDate && <> Do końca dnia: <b>{left(d.endsAt, now)}</b>.</>}</p>}
          {!d.running && !d.settled && <p className="muted small">Choinka jest czynna od {fmtDay(d.event.start)} do {fmtDay(d.event.end)}.</p>}
          {d.settled && <p className="muted small">Event się skończył, choinka została rozliczona.</p>}

          <section className={s.today} aria-label="Dzisiejsza karta">
            <h3><Gift size={16} aria-hidden="true" /> Dziś</h3>
            {hungToday
              ? <div className={s.hungRow}>
                  <PickTile item={{ person: hungToday.person, variant: hungToday.variant, value: hungToday.value }} />
                  <div>
                    <p>Powiesiłeś: <b>{person(hungToday.person)?.name}</b>{hungToday.variant !== 'normal' && <> ({variantName(hungToday.variant)})</>}.</p>
                    <p className="muted small">Do końca dnia możesz ją zdjąć i powiesić inną.</p>
                    <Button disabled={busy} onClick={() => act('/api/christmas/take', hungToday.item, 'Karta wróciła do ekwipunku')}><Trash2 size={16} aria-hidden="true" /> Zdejmij kartę</Button>
                  </div>
                </div>
              : d.running && !d.settled
                ? <Button kind="hue" disabled={busy} onClick={() => { Sound.click(); setPick(true); }}><TreePine size={16} aria-hidden="true" /> Powieś kartę</Button>
                : <p className="muted small">Dziś nie można wieszać kart.</p>}
          </section>
        </div>
      </div>

      <section className={s.rules} aria-label="Zasady">
        <h3>Jak to działa</h3>
        <ul>
          <li>Każdego dnia eventu możesz powiesić na choince <b>jedną kartę</b> ze swojego ekwipunku (nie ulubioną i nie specjalną).</li>
          <li><b>Powieszona karta nie wraca do Ciebie.</b> Do końca tego samego dnia możesz ją jeszcze zdjąć, potem trafia do wspólnej puli choinki.</li>
          <li>Po {fmtDay(d.event.end)} <b>karty z puli dostają inni gracze</b>, którzy też coś powiesili. Im więcej wartych kart powiesisz, tym <b>większa szansa</b>, że z puli trafi do Ciebie <b>więcej</b> i <b>lepszych</b> kart (cudzych, nie Twoich).</li>
          <li>Żebyś nic nie stracił, dostajesz też <b>{d.sharePct}%</b> wartości swoich powieszonych kart (zaokrąglone w górę) w losowych kartach w wariantach: {d.pool.map(p => p.name).join(', ') || '-'}{specials.length > 0 ? <>, oraz kartę specjalną: <b>{specials.join(', ')}</b></> : ', oraz kartę specjalną'}.</li>
        </ul>
      </section>

      <section className={s.mine} aria-label="Moje karty na choince">
        <h3>Moje karty na choince</h3>
        {d.mine.hung.length === 0
          ? <p className="muted">Jeszcze nic nie powiesiłeś.</p>
          : <>
              <p className="muted small">{d.mine.count} {d.mine.count === 1 ? 'karta' : 'kart'} o wartości {fmt(d.mine.value)}. Na koniec dostaniesz co najmniej {fmt(d.mine.budget)} ({d.sharePct}%) w losowych kartach świątecznych, a do tego szansę na karty z puli.</p>
              <ul className={s.hungList}>
                {d.mine.hung.map(h => (
                  <li key={h.item}><span>{fmtDay(h.day)}</span><b>{person(h.person)?.name}</b>{h.variant !== 'normal' && <span className="muted">{variantName(h.variant)}</span>}<span className="muted">{fmt(h.value)}</span></li>
                ))}
              </ul>
            </>}
      </section>

      {d.result && <ResultBlock r={d.result} />}

      {pick && <PickDialog sharePct={d.sharePct} onClose={() => setPick(false)} onPick={async id => { setPick(false); await act('/api/christmas/hang', id, 'Karta wisi na choince'); }} />}
      {all && <AllCards cards={d.cards} total={d.tree.cards} onClose={() => setAll(false)} />}
    </Modal>
  );
}

function ResultBlock({ r }: { r: TreeResult }) {
  return (
    <section className={s.result} aria-label="Wynik choinki">
      <h3>Twoja nagroda z choinki</h3>
      <p>Powiesiłeś {r.hung} {r.hung === 1 ? 'kartę' : 'kart'} (wartość {fmt(r.value)}). Za to dostałeś {r.rewards.length} {r.rewards.length === 1 ? 'kartę' : 'kart'} świątecznych o wartości {fmt(r.rewardsValue)} ({Math.round(r.rewardsValue / Math.max(1, r.value) * 100)}%) oraz {r.pool.length} {r.pool.length === 1 ? 'kartę' : 'kart'} z puli innych graczy o wartości {fmt(r.poolValue)}.</p>
      <ul className={s.hungList}>
        {r.rewards.map((x, i) => <li key={i}><b>{x.name}</b><span className="muted">{x.variantName}</span><span className="muted">{fmt(x.value)}</span>{x.special && <span className={s.special}>specjalna</span>}</li>)}
        {r.pool.map((x, i) => <li key={`p${i}`}><b>{x.name}</b><span className="muted">{x.variantName}</span><span className="muted">{fmt(x.value)}</span><span className={s.special}>z puli{x.from ? `: ${x.from}` : ''}</span></li>)}
      </ul>
    </section>
  );
}

function PickDialog({ onClose, onPick, sharePct }: { onClose: () => void; onPick: (id: number) => void; sharePct: number }) {
  const game = useGame();
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return game.items
      .filter(i => !i.fav && person(i.person)?.rarity !== 'special')
      .filter(i => !t || (person(i.person)?.name || '').toLowerCase().includes(t))
      .sort((a, b) => b.value - a.value)
      .slice(0, 300);
  }, [game.items, q]);
  return (
    <Modal title="Którą kartę powiesić?" onClose={onClose} huge>
      <p className="muted small">Wybrana karta NIE wróci do Ciebie: trafi do puli choinki dla innych graczy (do końca dnia możesz ją zdjąć). Im droższa, tym większa nagroda dla Ciebie.</p>
      <input className={s.search} type="search" placeholder="Szukaj karty" aria-label="Szukaj karty" value={q} onChange={e => setQ(e.target.value)} />
      <div className="pick-grid">
        {items.length === 0 && <p className="empty muted">Nie masz kart, które można powiesić.</p>}
        {items.map(i => <PickTile key={i.id} item={i} onClick={() => { const p = person(i.person); if (confirm(`Powiesić na choince: ${p?.name} (${fmt(i.value)})? Karta NIE wróci do Ciebie (do końca dnia możesz ją zdjąć). Na koniec eventu dostaniesz ${sharePct}% jej wartości w losowych kartach świątecznych.`)) onPick(i.id); }} />)}
      </div>
    </Modal>
  );
}

function AllCards({ cards, total, onClose }: { cards: Tree['cards']; total: number; onClose: () => void }) {
  return (
    <Modal title={`Karty na choince (${total})`} onClose={onClose} huge>
      {cards.length === 0 && <p className="muted">Choinka jest jeszcze pusta.</p>}
      {total > cards.length && <p className="muted small">Pokazuję {cards.length} najnowszych.</p>}
      <div className="pick-grid">
        {cards.map((c, i) => (
          <div key={i} className={s.cell}>
            <PickTile item={{ person: c.person, variant: c.variant, value: cardValue(c.person, c.variant) }} title={`${person(c.person)?.name} · ${c.user}`} />
            <span className={s.cap}>{c.user}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
