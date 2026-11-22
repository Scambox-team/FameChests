import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Gift, Info, Search, Trash2, TreePine } from 'lucide-react';
import { api } from '../../api/client';
import { PickTile } from '../../cards/PickTile';
import { cardValue, person, variantName } from '../../game/rules';
import { syncInventory } from '../../game/session';
import { useGame } from '../../game/store';
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

function TreeArt({ cards }: { cards: number }) {
  const shown = Math.min(cards, SPOTS.length);
  return (
    <svg className={s.art} viewBox="0 0 300 360" role="img" aria-label={`Choinka z ${cards} powieszonymi kartami`}>
      <rect x="132" y="308" width="36" height="38" rx="3" fill="#6a4426" />
      {TRIS.map((t, i) => <polygon key={i} points={t.map(p => p.join(',')).join(' ')} fill={['#1f7a40', '#1a6a38', '#145a2e'][i]} stroke="#0c3a1c" strokeWidth="2" strokeLinejoin="round" />)}
      <path d="M92 128 Q150 150 208 128 M72 208 Q150 238 228 208 M52 296 Q150 330 248 296" fill="none" stroke="#e8b64a" strokeWidth="2.4" strokeDasharray="1 7" strokeLinecap="round" opacity=".9" />
      <polygon className={s.star} points="150,6 156,22 173,22 159,32 165,48 150,38 135,48 141,32 127,22 144,22" fill="#ffd54a" stroke="#b8860b" strokeWidth="1.5" strokeLinejoin="round" />
      {SPOTS.slice(0, shown).map((p, i) => (
        <g key={i} className={s.bauble} style={{ animationDelay: `${(i % 9) * .35}s` }}>
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
          <li>Żebyś nic nie stracił, dostajesz też <b>{d.sharePct}%</b> wartości swoich powieszonych kart (zaokrąglone w górę) w losowych kartach w wariantach: {d.pool.map(p => p.name).join(', ') || '-'}, oraz kartę specjalną.</li>
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
