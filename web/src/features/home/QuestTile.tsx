import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Crosshair, Timer, Trophy } from 'lucide-react';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { crateOf, person, variantName } from '../../game/rules';
import { useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { CtfDialog, CtfSlide } from './CtfQuest';
import s from './home.module.css';

// czas do `nextAt` (sekundy): koniec questa albo 6 h po jego wypełnieniu - wtedy serwer losuje nowy
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

/** Questy na stronie startowej: list gończy (Wanted) i, gdy admin go włączył, zadanie CTF. Domyślnie widać Wanted,
 *  strzałki (albo przesunięcie palcem) przełączają na CTF. */
export function QuestTile() {
  const { quest, ctf } = useGame();
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const touchX = useRef<number | null>(null);
  const many = !!ctf;
  const at = many ? idx : 0;
  const go = (d: number) => setIdx(i => (i + d + 2) % 2);
  const names = ['Wanted', 'Capture the flag'];
  const other = names[(at + 1) % 2];
  return (
    <section className={`${s.tile} ${s.quest}${at === 1 ? ` ${s.questCtf}` : ''}`} aria-label="Questy"
      onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchX.current === null || !many) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}>
      <div className={s.qTrack} style={{ transform: `translateX(-${at * 100}%)` }}>
        <div className={s.qSlide} inert={at !== 0} aria-hidden={at !== 0}><WantedSlide quest={quest} /></div>
        {many && <div className={s.qSlide} inert={at !== 1} aria-hidden={at !== 1}><CtfSlide onOpen={() => setOpen(true)} /></div>}
      </div>
      {many && (
        <>
          <button type="button" className={`${s.qNav} ${s.qPrev}`} onClick={() => go(-1)} aria-label={`Pokaż quest: ${other}`}><ChevronLeft size={20} aria-hidden="true" /></button>
          <button type="button" className={`${s.qNav} ${s.qNext}`} onClick={() => go(1)} aria-label={`Pokaż quest: ${other}`}><ChevronRight size={20} aria-hidden="true" /></button>
          <div className={s.qDots}>
            {names.map((n, i) => <button key={n} type="button" aria-pressed={at === i} aria-label={`Quest: ${n}`} className={at === i ? s.qDotOn : ''} onClick={() => setIdx(i)} />)}
          </div>
        </>
      )}
      {open && <CtfDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

/** Quest Wanted: list gończy (karta w wariancie Wanted) przybity gwoździem do deski.
 *  Wykonany quest zrywa kartę z gwoździa, zostają strzępki; po wejściu na stronę z wykonanym questem są już tylko strzępki. */
function WantedSlide({ quest: q }: { quest: any }) {
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
