import { useEffect, useRef, useState } from 'react';
import { Timer, Trophy } from 'lucide-react';
import { Card } from '../../cards/Card';
import { person, variantName } from '../../game/rules';
import { useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import s from './home.module.css';

// czas do północy: wtedy serwer losuje nowy quest
function useCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const end = new Date(now); end.setHours(24, 0, 0, 0);
  const left = Math.max(0, Math.floor((end.getTime() - now) / 1000));
  return [left / 3600, left / 60 % 60, left % 60].map(n => String(Math.floor(n)).padStart(2, '0')).join(':');
}

type Phase = 'pinned' | 'tearing' | 'torn';

/** Quest dnia: list gończy (karta w wariancie Wanted) przybity gwoździem do deski.
 *  Wykonany quest zrywa kartę z gwoździa, zostają strzępki; po wejściu na stronę z wykonanym questem są już tylko strzępki. */
export function QuestTile() {
  const { quest: q } = useGame();
  const done = !!q?.done;
  const [phase, setPhase] = useState<Phase>(done ? 'torn' : 'pinned');
  const was = useRef(done);
  const left = useCountdown();

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
    <section className={`${s.tile} ${s.quest}`} aria-label="Quest dnia">
      <div className={`${s.plank} ${s[phase]}`}>
        <span className={s.nail} aria-hidden="true" />
        {q && phase !== 'torn' && (
          <div className={s.poster}>
            {target ? <Card person={q.person} variant="wanted" /> : <div className={s.blankPoster}><b>WANTED</b><span>dowolna karta</span></div>}
          </div>
        )}
        {q && phase !== 'pinned' && (
          <div className={s.scraps} aria-hidden="true"><i className={s.scrap} /><i className={s.bit} /><i className={`${s.bit} ${s.bit2}`} /></div>
        )}
        {!q && <p className={s.empty}>Dziś nikt nie jest poszukiwany</p>}
      </div>
      <div className={s.copy}>
        <span className={s.kicker}>Quest dnia</span>
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
        <span className={s.timer}><Timer size={15} aria-hidden="true" />Nowy quest za <b>{left}</b></span>
      </div>
    </section>
  );
}
