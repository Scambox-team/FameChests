import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Timer, Trophy } from 'lucide-react';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { person, variantName } from '../../game/rules';
import { useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import s from './home.module.css';

// czas do `nextAt` (sekundy): koniec questa albo 6 h po jego wypełnieniu - wtedy serwer losuje nowy
function useCountdown(nextAt?: number) {
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

/** Quest: list gończy (karta w wariancie Wanted) przybity gwoździem do deski.
 *  Wykonany quest zrywa kartę z gwoździa, zostają strzępki; po wejściu na stronę z wykonanym questem są już tylko strzępki. */
export function QuestTile() {
  const { quest: q } = useGame();
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
    <section className={`${s.tile} ${s.quest}`} aria-label="Quest">
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
        <span className={s.kicker}>Quest</span>
        {!q ? <p className={s.lead}>Questy są teraz wyłączone. Wrócą, gdy włączy je admin.</p>
          : !done ? (
            <>
              <h2 className={s.name}>{target ? target.name : 'Dowolna karta'}{q.variant ? <span className={s.qVariant}> · {variantName(q.variant)}</span> : null}</h2>
              <p className={s.lead}>Zdobądź tę kartę ze skrzynki, kuźni lub kasyna. Kto pierwszy, dostaje ją w wariancie {variantName('wanted')}{q.reward ? ` i ${fmt(q.reward)}` : ''}.</p>
            </>
          ) : q.mine ? (
            <p className={`${s.lead} ${s.won}`}><Trophy size={16} aria-hidden="true" />Quest jest twój: {person(q.wonPerson || q.person).name} w wariancie {variantName('wanted')} i {fmt(q.money)}.</p>
          ) : (
            <p className={s.lead}>Ktoś był szybszy. List zerwał {q.winner || 'nieznany gracz'}.</p>
          )}
        {q && done && q.wonAt && <span className={s.timer}><CheckCircle2 size={15} aria-hidden="true" />Wykonano o <b>{questTime(q.wonAt)}</b></span>}
        {q && <span className={s.timer}><Timer size={15} aria-hidden="true" />{done ? 'Nowy quest za' : 'Quest kończy się za'} <b>{left}</b></span>}
      </div>
    </section>
  );
}
