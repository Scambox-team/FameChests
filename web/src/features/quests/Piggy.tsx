import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Hammer, Medal, PiggyBank, Timer, Trophy, Users } from 'lucide-react';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { variantName } from '../../game/rules';
import { syncInventory } from '../../game/session';
import { S } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { use3D } from '../../three/support';
import type { PiggyScene } from '../../three/piggyScene';
import { toast } from '../../ui/Toaster';
import { useCountdown } from '../home/QuestTile';
import s from './quests.module.css';

// Skarbonka (server/src/routes/piggy.rs): wspólny cel na dobę, świnka tyje razem z postępem, pełną trzeba razem rozbić.
// `PiggyStage` (scena 3D + klikanie + rozbijanie) jest wspólna dla zakładki Questy i kafelka na stronie startowej.
// Scena 3D w three/piggyScene.ts (dynamiczny import po use3D()), bez grafiki 3D płaska świnka w SVG (FlatPig).

export type PiggyQuest = {
  day: string; kind: string; title: string; desc: string; rarity: string; rarityName: string;
  target: number; total: number; startsAt: number; endsAt: number; filledAt: number; brokenAt: number;
  hits: number; needHits: number; breakers: number; minBreakers: number; participants: number;
  top: { name: string; amount: number }[];
  shares: { name: string; amount: number; me: boolean }[]; rest: number; restCount: number;
  places: string[];
  mine: { amount: number; hits: number; place: number | null; reward: { id: number; person: string; variant: string; name: string } | null };
};
export type PiggyData = { enabled: boolean; quest: PiggyQuest | null; previous: PiggyQuest | null };

export const usePiggy = (poll = 0) =>
  useQuery({ queryKey: ['piggy'], queryFn: () => api<PiggyData>('/api/piggy'), staleTime: 4000, refetchInterval: poll || false });

const MEDALS = ['#e5b94a', '#c2c6cf', '#c98a55'];
const SEND_MS = 450;
const SHARE_COLORS = ['#ff7aa8', '#ffb35c', '#ffe066', '#7be08f', '#5ad1e8', '#7c9cff', '#b98aff', '#ff8ad8', '#f0a07a', '#9be0c8', '#c8d86a', '#a0b4d8'];
/** przykładowa osoba do podglądu nagród (karta o rzadkości z questa) */
export const sampleOf = (rarity: string) => Object.keys(S.cfg?.people ?? {}).find(id => S.cfg.people[id].rarity === rarity && !S.cfg.people[id].hidden);

/** Pasek postępu podzielony na graczy (kto ile wpłacił) */
export function ShareBar({ q, compact }: { q: PiggyQuest; compact?: boolean }) {
  const scale = Math.max(q.target, q.total);
  const pct = Math.min(100, (q.total / q.target) * 100);
  // dymek po najechaniu: czyja to część paska i jak bardzo się przyczynił (kwota, udział we wpłatach i w celu)
  const [tip, setTip] = useState<{ name: string; amount: number; color: string; x: number } | null>(null);
  const show = (e: React.PointerEvent | React.FocusEvent, name: string, amount: number, color: string) => {
    const el = e.currentTarget as HTMLElement;
    const bar = el.closest('[role="progressbar"]') as HTMLElement;
    const r = bar.getBoundingClientRect(), c = el.getBoundingClientRect();
    const x = 'clientX' in e ? e.clientX - r.left : c.left + c.width / 2 - r.left;
    setTip({ name, amount, color, x: Math.min(Math.max(x, 100), Math.max(100, r.width - 100)) });
  };
  const seg = (key: string, name: string, amount: number, color: string, cls: string, style: React.CSSProperties) => (
    <i key={key} className={cls} style={{ ...style, width: `${(amount / scale) * 100}%` }} tabIndex={0} aria-label={`${name}: ${fmt(amount)}`}
      onPointerEnter={e => show(e, name, amount, color)} onPointerMove={e => show(e, name, amount, color)} onPointerLeave={() => setTip(null)}
      onFocus={e => show(e, name, amount, color)} onBlur={() => setTip(null)} />
  );
  return (
    <div className={`${s.bar}${compact ? ` ${s.barSmall}` : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={q.target} aria-valuenow={q.total}
      aria-label={`Skarbonka: ${fmt(q.total)} z ${fmt(q.target)}`}>
      <div className={s.barFill}>
        {q.shares.map((p, i) => seg(p.name, p.me ? `${p.name} (ty)` : p.name, p.amount, SHARE_COLORS[i % SHARE_COLORS.length], p.me ? s.mine : '', { background: SHARE_COLORS[i % SHARE_COLORS.length] }))}
        {q.rest > 0 && seg('rest', `Pozostali (${q.restCount})`, q.rest, '#ffffff66', s.restShare, {})}
      </div>
      {!compact && <b className={s.barPct}>{Math.floor(pct)}%</b>}
      {tip && (
        <span className={s.tip} style={{ left: tip.x }} role="tooltip">
          <i className={s.tipDot} style={{ background: tip.color }} aria-hidden="true" />
          <b>{tip.name}</b>
          <span>{fmt(tip.amount)} · {q.total ? Math.round((tip.amount / q.total) * 100) : 0}% wpłat · {Math.round((tip.amount / q.target) * 100)}% celu</span>
        </span>
      )}
    </div>
  );
}

/** Płaska świnka (bez WebGL): ta sama pulchność, pęknięcia i kołysanie co w 3D; po rozbiciu deszcz monet */
function FlatPig({ fill, crack, broken, wiggle }: { fill: number; crack: number; broken: boolean; wiggle: number }) {
  const sx = 0.82 + 0.42 * Math.min(1.1, fill), sy = 0.86 + 0.24 * Math.min(1.1, fill);
  const cracks = ['M150 70 l12 18 l-8 14 l16 20', 'M118 92 l-14 10 l4 16 l-12 12', 'M172 104 l18 4 l6 16', 'M134 60 l-6 -14 l10 -10', 'M160 128 l-10 14 l8 12', 'M110 120 l16 8 l-2 18', 'M188 80 l14 -8 l10 6'];
  const shown = Math.round(Math.min(1, crack) * cracks.length);
  if (broken) {
    return (
      <div className={s.flatBurst} aria-hidden="true">
        {Array.from({ length: 56 }, (_, i) => (
          <i key={i} className={i % 3 === 0 ? s.fCoin : i % 3 === 1 ? s.fNote : ''}
            style={{ ['--a' as any]: `${(i * 137) % 360}deg`, ['--d' as any]: `${50 + (i % 7) * 22}px`, animationDelay: `${(i % 9) * 0.05}s` }} />
        ))}
      </div>
    );
  }
  return (
    <svg viewBox="0 0 300 200" className={s.flatPig} aria-hidden="true">
      <g key={wiggle} className={wiggle ? s.wiggle : ''} style={{ transformOrigin: '150px 150px' }}>
        <g transform={`translate(150 110) scale(${sx} ${sy}) translate(-150 -110)`}>
          <ellipse cx="150" cy="182" rx="90" ry="9" fill="#0004" />
          {[[105, 150], [125, 155], [175, 155], [195, 150]].map(([x, y]) => <rect key={x} x={x - 10} y={y} width="20" height="26" rx="8" fill="#e98cad" />)}
          <ellipse cx="150" cy="110" rx="100" ry="66" fill="#f4a3bf" />
          <ellipse cx="128" cy="86" rx="46" ry="18" fill="#fff" opacity=".25" />
          <rect x="128" y="46" width="44" height="6" rx="3" fill="#3a1422" />
          <path d="M98 58 l-10 -26 l26 14 z M200 58 l12 -26 l-26 14 z" fill="#e98cad" />
          <ellipse cx="250" cy="112" rx="18" ry="22" fill="#e98cad" />
          <ellipse cx="246" cy="104" rx="3" ry="6" fill="#3a1422" /><ellipse cx="246" cy="120" rx="3" ry="6" fill="#3a1422" />
          <circle cx="222" cy="88" r="5" fill="#141014" /><circle cx="224" cy="86" r="1.6" fill="#fff" />
          <path d="M50 100 q-14 -6 -10 -18 q6 -8 12 2" stroke="#e98cad" strokeWidth="5" fill="none" strokeLinecap="round" />
          {cracks.slice(0, shown).map((d, i) => <path key={i} d={d} stroke="#5a1f33" strokeWidth="2.6" fill="none" strokeLinejoin="round" />)}
        </g>
      </g>
    </svg>
  );
}

/** Scena skarbonki: świnka 3D (albo płaska), klikanie = szturchanie, a przy pełnej rozbijanie razem z innymi graczami. */
export function PiggyStage({ q, compact }: { q: PiggyQuest; compact?: boolean }) {
  const qc = useQueryClient();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<PiggyScene | null>(null);
  const [flat, setFlat] = useState(() => !use3D());
  const [wiggle, setWiggle] = useState(0);
  const pending = useRef(0);
  const [pendingShown, setPendingShown] = useState(0);
  const flushing = useRef(false);
  const lastSend = useRef(0);
  const lastOink = useRef(0);
  const timer = useRef(0);
  const lastTotal = useRef<number | null>(null);
  const wasBroken = useRef<boolean | null>(null);

  const fill = q.total / Math.max(1, q.target);
  const full = q.filledAt > 0;
  const broken = q.brokenAt > 0;
  const crack = full ? Math.min(1, (q.hits + pendingShown) / Math.max(1, q.needHits)) : 0;
  const latest = useRef({ fill, crack, broken });
  latest.current = { fill, crack, broken };

  // scena 3D
  useEffect(() => {
    if (flat || !canvas.current) return;
    let alive = true;
    import('../../three/piggyScene').then(m => {
      if (!alive || !canvas.current) return;
      try { scene.current = m.createPiggyScene(canvas.current); scene.current.set(latest.current); } catch { setFlat(true); }
    }).catch(() => setFlat(true));
    return () => { alive = false; scene.current?.dispose(); scene.current = null; };
  }, [flat]);
  useEffect(() => { scene.current?.set({ fill, crack, broken }); });

  // monety wpadające do świnki, gdy ktoś wpłacił; dźwięk i powiadomienie, gdy świnka pękła (także u innych graczy)
  useEffect(() => {
    if (lastTotal.current !== null && q.total > lastTotal.current) { scene.current?.coin(); Sound.coin(1); }
    lastTotal.current = q.total;
    if (wasBroken.current === false && broken) {
      Sound.pin('jackpot'); Sound.oink('squeal');
      if (q.mine.reward) { toast(`Skarbonka rozbita! Twoja nagroda: ${q.mine.reward.name} (${variantName(q.mine.reward.variant)})`); syncInventory(null, true); }
    }
    wasBroken.current = broken;
  }, [q.total, broken]);  // eslint-disable-line react-hooks/exhaustive-deps

  // uderzenia wysyłane paczkami (najwyżej 10 naraz), nie częściej niż co SEND_MS - serwer odrzuca zbyt częste zapytania
  const schedule = () => {
    if (timer.current || !pending.current) return;
    timer.current = window.setTimeout(flush, Math.max(0, SEND_MS - (Date.now() - lastSend.current)));
  };
  const flush = async () => {
    timer.current = 0;
    if (flushing.current || !pending.current) return;
    flushing.current = true;
    lastSend.current = Date.now();
    const n = Math.min(10, pending.current);
    pending.current -= n;
    try {
      const r = await api<{ quest: PiggyQuest; broke: boolean }>('/api/piggy/hit', { n });
      qc.setQueryData<PiggyData>(['piggy'], old => old ? { ...old, quest: r.quest } : old);
    } catch (e: any) {
      if (/szybko|fast/i.test(e.message)) pending.current += n;   // za szybko: spróbujemy jeszcze raz
      else { pending.current = 0; toast(e.message, true); }
    } finally {
      flushing.current = false;
      setPendingShown(pending.current);
      schedule();
    }
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const click = () => {
    if (broken) return;
    scene.current?.poke();
    setWiggle(w => w + 1);
    // jedyny dźwięk przy kliknięciu: prawdziwe chrumknięcie (nie częściej niż co 90 ms)
    if (Date.now() - lastOink.current > 90) { lastOink.current = Date.now(); Sound.oink('grunt'); }
    if (!full) return;
    pending.current += 1;
    setPendingShown(pending.current);
    schedule();
  };

  const hint = broken ? 'Skarbonka rozbita - nagrody rozdane!'
    : full ? `Pełna! Rozbijcie ją razem: ${Math.min(q.hits + pendingShown, q.needHits)} / ${q.needHits} uderzeń, ${q.breakers} / ${q.minBreakers} osób`
    : '';
  return (
    <button type="button" className={`${s.stage}${compact ? ` ${s.compact}` : ''}${full ? ` ${s.fullStage}` : ''}`} onClick={click} disabled={broken && !flat}
      aria-label={full ? 'Uderz w skarbonkę' : 'Szturchnij skarbonkę'}>
      {flat ? <FlatPig fill={fill} crack={crack} broken={broken} wiggle={wiggle} /> : <canvas ref={canvas} className={s.canvas} />}
      {hint && <span className={s.hint}>{full && !broken && <Hammer size={15} aria-hidden="true" />}{hint}</span>}
    </button>
  );
}

/** Główny quest: skarbonka (zakładka Questy) */
export function PiggyQuestPanel() {
  const { data } = usePiggy(4000);
  const q = data?.quest ?? null;
  const prev = data?.previous ?? null;
  const left = useCountdown(q?.endsAt);
  const sample = useMemo(() => (q ? sampleOf(q.rarity) : undefined), [q?.rarity]);
  const broken = !!q && q.brokenAt > 0;
  const full = !!q && q.filledAt > 0;

  if (!data) return <section className={s.piggy}><p className="muted">Ładowanie skarbonki…</p></section>;
  if (!q) {
    return (
      <section className={`${s.piggy} ${s.off}`}>
        <div className={s.head}><span className={s.kicker}><PiggyBank size={15} aria-hidden="true" />Quest główny · Skarbonka</span></div>
        <p className={s.lead}>Skarbonka jest teraz wyłączona. Wróci, gdy włączy ją admin.</p>
        {prev && <PrevDay q={prev} />}
      </section>
    );
  }
  return (
    <section className={`${s.piggy}${full ? ` ${s.full}` : ''}${broken ? ` ${s.broken}` : ''}`} aria-labelledby="piggyTitle">
      <div className={s.head}>
        <span className={s.kicker}><PiggyBank size={15} aria-hidden="true" />Quest główny · Skarbonka</span>
        <span className={s.timer}><Timer size={15} aria-hidden="true" />{broken ? 'Nowa skarbonka za' : 'Koniec za'} <b>{left}</b></span>
      </div>
      <div className={s.grid}>
        <PiggyStage q={q} />
        <div className={s.info}>
          <h2 id="piggyTitle" className={s.title}>{q.title}</h2>
          <p className={s.lead}>{q.desc} Cel jest wspólny dla wszystkich graczy i liczy się w złotówkach.</p>
          <div className={s.amounts}>
            <b>{fmt(q.total)}</b><span>z {fmt(q.target)}</span>
            <span className={s.people}><Users size={14} aria-hidden="true" />{q.participants}</span>
          </div>
          <ShareBar q={q} />
          <ol className={s.podium} aria-label="Najwięcej wpłacili">
            {[0, 1, 2].map(i => (
              <li key={i} className={q.top[i] ? '' : s.emptyPlace}>
                <Medal size={18} color={MEDALS[i]} aria-hidden="true" />
                <span className={s.pName}>{q.top[i]?.name ?? 'wolne miejsce'}</span>
                <span className={s.pVal}>{q.top[i] ? fmt(q.top[i].amount) : ''}</span>
                <span className={s.pPrize}>{variantName(q.places[i])}</span>
              </li>
            ))}
          </ol>
          <p className={s.me}>
            <Coins size={15} aria-hidden="true" />
            {q.mine.amount > 0 ? <>Twój wkład: <b>{fmt(q.mine.amount)}</b>{q.mine.place ? <> · {q.mine.place}. miejsce</> : null}</> : 'Jeszcze nic nie wpłaciłeś - wystarczy zrobić coś z zadania.'}
          </p>
          {broken && q.mine.reward && (
            <div className={s.myReward}>
              <button type="button" className={s.rewardCard} onClick={() => openViewer(q.mine.reward!.person, q.mine.reward!.variant, q.mine.reward!.id)} aria-label={`Podgląd nagrody: ${q.mine.reward.name}`}>
                <Card person={q.mine.reward.person} variant={q.mine.reward.variant} uid={q.mine.reward.id} />
              </button>
              <p><Trophy size={15} aria-hidden="true" />Twoja nagroda: <b>{q.mine.reward.name}</b> w wariancie {variantName(q.mine.reward.variant)}. Jest już w ekwipunku.</p>
            </div>
          )}
        </div>
      </div>
      {prev && <PrevDay q={prev} />}
      <span hidden>{sample}</span>
    </section>
  );
}

/** Kafelek z nagrodami skarbonki: cztery banknoty (karta o rzadkości z dzisiejszego questa) */
export function PiggyPrizes({ q }: { q: PiggyQuest }) {
  const sample = useMemo(() => sampleOf(q.rarity), [q.rarity]);
  return (
    <>
      <h2 className={s.tileTitle}>Nagrody skarbonki</h2>
      <p className={s.lead}>Karta {q.rarityName} dla każdego, kto wpłacił. Im wyższe miejsce, tym lepszy banknot.</p>
      <div className={s.prizeRow}>
        {q.places.map((v, i) => (
          <figure key={v} className={s.prize}>
            {sample ? <button type="button" className={s.prizeCard} onClick={() => openViewer(sample, v)} aria-label={`Podgląd wariantu ${variantName(v)}`}><Card person={sample} variant={v} /></button> : null}
            <figcaption>{i < 3 ? `${i + 1}. miejsce` : 'Pozostali'} · {variantName(v)}</figcaption>
          </figure>
        ))}
      </div>
      <p className="muted small">Gdy świnka się zapełni, trzeba ją razem rozbić (kilka osób klika). Jeśli nikt jej nie rozbije, pęknie sama o północy. Niezapełniona skarbonka przepada.</p>
    </>
  );
}

function PrevDay({ q }: { q: PiggyQuest }) {
  const ok = q.brokenAt > 0;
  return (
    <p className={s.prev}>
      Wczoraj ({q.title.toLowerCase()}): {ok ? `cel osiągnięty, ${fmt(q.total)} z ${fmt(q.target)}.` : `zabrakło ${fmt(Math.max(0, q.target - q.total))}.`}
      {q.mine.reward ? ` Twoja nagroda: ${q.mine.reward.name} (${variantName(q.mine.reward.variant)}).` : ''}
    </p>
  );
}
