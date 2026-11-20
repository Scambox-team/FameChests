import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Crosshair, PiggyBank, Timer, Trophy } from 'lucide-react';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { crateOf, person, variantName } from '../../game/rules';
import { useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { PiggyStage, ShareBar, usePiggy, type PiggyQuest } from '../quests/Piggy';
import qs from '../quests/quests.module.css';
import { CtfDialog, CtfSlide } from './CtfQuest';
import s from './home.module.css';

// czas do `nextAt` (sekundy): koniec questa albo 4 h po jego wypełnieniu - wtedy serwer losuje nowy
export function useCountdown(nextAt?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = nextAt ? Math.max(0, Math.floor(nextAt - now / 1000)) : 0;
  return [left / 3600, left / 60 % 60, left % 60].map(n => String(Math.floor(n)).padStart(2, '0')).join(':');
}

/** Godzina wypełnienia questa (z dniem, gdy to nie dziś) */
export function questTime(at: number) {
  const d = new Date(at * 1000);
  const time = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' })}, ${time}`;
}

type Phase = 'pinned' | 'tearing' | 'torn';
type Slide = 'wanted' | 'ctf' | 'piggy';
const SLIDE_NAMES: Record<Slide, string> = { wanted: 'Wanted', ctf: 'Capture the flag', piggy: 'Skarbonka' };
/** co ile karuzela sama przechodzi do następnego questa (ms) */
const AUTO_MS = 8000;

/** Questy na stronie startowej: karuzela - list gończy (Wanted), zadanie CTF i wspólna Skarbonka (te, które admin włączył).
 *  Domyślnie widać pierwszy z nich (Wanted); co `AUTO_MS` karuzela sama przechodzi dalej (stoi, gdy kursor myszy albo fokus z klawiatury
 *  jest na kafelku i gdy otwarte jest okno CTF; ręczna zmiana i dotyk liczą czas od nowa); strzałki, kropki albo przesunięcie palcem przełączają. Żaden quest nie jest
 *  „główny”: w zakładce Questy Skarbonka stoi na górze, tutaj jest jednym ze slajdów (i da się ją szturchać i rozbijać). */
export function QuestTile() {
  const { quest, ctf } = useGame();
  const { data } = usePiggy(10_000);
  const piggy = data?.quest;
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const touchX = useRef<number | null>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [touched, setTouched] = useState(0);
  const slides: Slide[] = [...(quest || (!ctf && !piggy) ? ['wanted' as const] : []), ...(ctf ? ['ctf' as const] : []), ...(piggy ? ['piggy' as const] : [])];
  const n = slides.length, at = Math.min(idx, n - 1), many = n > 1, cur = slides[at];
  const go = (d: number) => setIdx(i => (Math.min(i, n - 1) + d + n) % n);
  useEffect(() => {
    if (!many || hover || focus || open) return;
    const t = setTimeout(() => setIdx(i => (Math.min(i, n - 1) + 1) % n), AUTO_MS);
    return () => clearTimeout(t);
  }, [at, n, many, hover, focus, open, touched]);
  return (
    <section className={`${s.tile} ${s.quest}${cur === 'ctf' ? ` ${s.questCtf}` : ''}${cur === 'piggy' ? ` ${qs.questPiggy}` : ''}`} aria-label="Questy"
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(true); }} onPointerLeave={() => setHover(false)}
      onFocus={e => { if ((e.target as Element).matches(':focus-visible')) setFocus(true); }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); }}
      onTouchStart={e => { touchX.current = e.touches[0].clientX; setTouched(t => t + 1); }}
      onTouchEnd={e => {
        if (touchX.current === null || !many) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}>
      <div className={s.qTrack} style={{ transform: `translateX(-${at * 100}%)` }}>
        {slides.map((k, i) => (
          <div key={k} className={s.qSlide} inert={at !== i} aria-hidden={at !== i}>
            {k === 'wanted' ? <WantedSlide quest={quest} /> : k === 'ctf' ? <CtfSlide onOpen={() => setOpen(true)} /> : <PiggySlide q={piggy!} />}
          </div>
        ))}
      </div>
      <Link to="/quests" className={s.qAll}>Wszystkie questy<ArrowRight size={14} aria-hidden="true" /></Link>
      {many && (
        <>
          <button type="button" className={`${s.qNav} ${s.qPrev}`} onClick={() => go(-1)} aria-label={`Pokaż quest: ${SLIDE_NAMES[slides[(at - 1 + n) % n]]}`}><ChevronLeft size={20} aria-hidden="true" /></button>
          <button type="button" className={`${s.qNav} ${s.qNext}`} onClick={() => go(1)} aria-label={`Pokaż quest: ${SLIDE_NAMES[slides[(at + 1) % n]]}`}><ChevronRight size={20} aria-hidden="true" /></button>
          <div className={s.qDots}>
            {slides.map((k, i) => <button key={k} type="button" aria-pressed={at === i} aria-label={`Quest: ${SLIDE_NAMES[k]}`} className={at === i ? s.qDotOn : ''} onClick={() => setIdx(i)} />)}
          </div>
        </>
      )}
      {open && <CtfDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

/** Skarbonka jako slajd karuzeli: świnka 3D (szturchanie i rozbijanie razem z innymi) i stan wspólnego celu */
function PiggySlide({ q }: { q: PiggyQuest }) {
  const left = useCountdown(q.endsAt);
  return (
    <>
      <div className={qs.slideStage}><PiggyStage q={q} compact /></div>
      <div className={s.copy}>
        <span className={s.kicker}><PiggyBank size={14} aria-hidden="true" />Quest · Skarbonka</span>
        <h2 className={s.name}>{q.title}</h2>
        <p className={s.lead}>{q.brokenAt ? 'Skarbonka rozbita, nagrody rozdane. Nowa po północy.' : q.filledAt ? 'Skarbonka pełna - rozbijcie ją razem!' : `Wspólna skarbonka: ${fmt(q.total)} z ${fmt(q.target)}.`}</p>
        <ShareBar q={q} compact />
        {!q.brokenAt && <span className={s.timer}><Timer size={15} aria-hidden="true" />Kończy się za <b>{left}</b></span>}
      </div>
    </>
  );
}

/** Quest Wanted: list gończy (karta w wariancie Wanted) przybity gwoździem do deski.
 *  Wykonany quest zrywa kartę z gwoździa, zostają strzępki; po wejściu na stronę z wykonanym questem są już tylko strzępki. */
export function WantedSlide({ quest: q }: { quest: any }) {
  const done = !!q?.done;
  const [phase, setPhase] = useState<Phase>(done ? 'torn' : 'pinned');
  const was = useRef(done);
  const left = useCountdown(q?.nextAt);

  useEffect(() => {
    if (done === was.current) return;
    was.current = done;
    if (!done) { setPhase('pinned'); return; }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setPhase('torn'); return; }
    setPhase('tearing');
    const t = setTimeout(() => setPhase('torn'), 1500);
    return () => clearTimeout(t);
  }, [done]);

  const target = q?.person ? person(q.person) : null;
  return (
    <>
      <div className={`${s.plank} ${s[phase]}`}>
        <span className={s.nail} aria-hidden="true" />
        {q && phase !== 'torn' && (
          target ? (
            <button type="button" className={`${s.poster} ${s.posterBtn}`} aria-label={`Podgląd listu gończego: ${target.name}`} onClick={() => openViewer(q.person, 'wanted')}>
              <Card person={q.person} variant="wanted" />
            </button>
          ) : (
            <div className={s.poster}><div className={s.blankPoster}><b>WANTED</b><span>dowolna karta</span></div></div>
          )
        )}
        {q && phase !== 'pinned' && (
          <div className={s.scraps} aria-hidden="true"><i className={s.scrap} /><i className={s.bit} /><i className={`${s.bit} ${s.bit2}`} /></div>
        )}
        {!q && <p className={s.empty}>Teraz nikt nie jest poszukiwany</p>}
      </div>
      <div className={s.copy}>
        <span className={s.kicker}><Crosshair size={14} aria-hidden="true" />Quest · Wanted</span>
        {!q ? <p className={s.lead}>Questy są teraz wyłączone. Wrócą, gdy włączy je admin.</p>
          : !done ? (
            <>
              <h2 className={s.name}>{target ? target.name : 'Dowolna karta'}{q.variant ? <span className={s.qVariant}> · {variantName(q.variant)}</span> : null}</h2>
              <p className={s.lead}>Zdobądź tę kartę ze skrzynki, kuźni lub kasyna.{q.minMult ? ` Potrzebny wariant z mnożnikiem wartości co najmniej ${q.minMult}x.` : ''} Kto pierwszy, dostaje ją w wariancie {variantName('wanted')}{q.reward ? ` i ${fmt(q.reward)}` : ''}.</p>
              {q.limitReached && <p className={s.where}>Przekroczono dzienny limit questów Wanted. Do jutra nie odbierzesz już karty ani pieniędzy z tego questa.</p>}
              {!!q.crates?.length && <p className={s.where}>Wypada ze skrzynek: {q.crates.map((id: string) => crateOf(id)?.short ?? id).join(', ')}.</p>}
            </>
          ) : q.mine ? (
            <p className={`${s.lead} ${s.won}`}><Trophy size={16} aria-hidden="true" />Quest jest twój: {person(q.wonPerson || q.person).name} w wariancie {variantName('wanted')} i {fmt(q.money)}.</p>
          ) : (
            <p className={s.lead}>Ktoś był szybszy. List zerwał {q.winner || 'nieznany gracz'}.</p>
          )}
        {q && done && q.wonAt && <span className={s.timer}><CheckCircle2 size={15} aria-hidden="true" />Wykonano o <b>{questTime(q.wonAt)}</b></span>}
        {q && <span className={s.timer}><Timer size={15} aria-hidden="true" />{done ? 'Nowy quest za' : 'Quest kończy się za'} <b>{left}</b></span>}
      </div>
    </>
  );
}
