import { Link } from 'react-router-dom';
import { ArrowRight, Crosshair, ScrollText, Terminal, Timer, PiggyBank } from 'lucide-react';
import { Card } from '../../cards/Card';
import { person } from '../../game/rules';
import { useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { useCountdown } from '../home/QuestTile';
import h from '../home/home.module.css';
import { PiggyStage, ShareBar, usePiggy } from './Piggy';
import s from './quests.module.css';

type Pick = { kind: 'piggy' | 'wanted' | 'ctf'; endsAt: number };

/** Kafelek na stronie startowej: quest, który najwcześniej się kończy. Skarbonka jest tu w całości grywalna (świnka 3D, szturchanie
 *  i rozbijanie razem z innymi); Wanted i CTF prowadzą do /quests. */
export function QuestsTile() {
  const { quest, ctf } = useGame();
  const { data } = usePiggy(10_000);
  const piggy = data?.quest;
  const open: Pick[] = [];
  if (piggy && !piggy.brokenAt) open.push({ kind: 'piggy', endsAt: piggy.endsAt });
  if (quest && !quest.done) open.push({ kind: 'wanted', endsAt: quest.endsAt ?? quest.nextAt });
  if (ctf && !ctf.done) open.push({ kind: 'ctf', endsAt: ctf.endsAt ?? ctf.nextAt });
  open.sort((a, b) => (a.endsAt || Infinity) - (b.endsAt || Infinity));
  const pick: Pick | undefined = open[0];
  const left = useCountdown(pick?.endsAt);
  const target = pick?.kind === 'wanted' && quest?.person ? person(quest.person) : null;
  const isPiggy = pick?.kind === 'piggy' && !!piggy;
  return (
    <section className={`${h.tile} ${s.tile}${isPiggy ? ` ${s.tilePiggy}` : ''}`} aria-label="Questy">
      {isPiggy ? (
        <div className={s.tileStage}><PiggyStage q={piggy!} compact /></div>
      ) : (
        <Link to="/quests" className={s.tileArt} tabIndex={-1} aria-hidden="true">
          {pick?.kind === 'wanted' && target ? <span className={s.tilePoster}><Card person={quest.person} variant="wanted" /></span>
            : pick?.kind === 'ctf' ? <Terminal className={s.tilePig} strokeWidth={1.2} />
            : <ScrollText className={s.tilePig} strokeWidth={1.2} />}
        </Link>
      )}
      <div className={h.copy}>
        <span className={h.kicker}>
          {pick?.kind === 'wanted' ? <Crosshair size={14} aria-hidden="true" /> : pick?.kind === 'piggy' ? <PiggyBank size={14} aria-hidden="true" /> : <ScrollText size={14} aria-hidden="true" />}
          Questy{pick ? ` · ${pick.kind === 'piggy' ? 'Skarbonka' : pick.kind === 'wanted' ? 'Wanted' : 'CTF'}` : ''}
        </span>
        {!pick ? (
          <>
            <h2 className={h.name}>Questy</h2>
            <p className={h.lead}>Teraz nie ma otwartych questów. Zajrzyj, kto wygrał ostatnie.</p>
          </>
        ) : isPiggy ? (
          <>
            <h2 className={h.name}>{piggy!.title}</h2>
            <p className={h.lead}>{piggy!.filledAt ? 'Skarbonka pełna - rozbijcie ją razem!' : `Wspólna skarbonka: ${fmt(piggy!.total)} z ${fmt(piggy!.target)}.`}</p>
            <ShareBar q={piggy!} compact />
          </>
        ) : pick.kind === 'wanted' ? (
          <>
            <h2 className={h.name}>{target ? target.name : 'Dowolna karta'}</h2>
            <p className={h.lead}>Kto pierwszy zdobędzie tę kartę, dostaje ją w wariancie Wanted{quest?.reward ? ` i ${fmt(quest.reward)}` : ''}.</p>
          </>
        ) : (
          <>
            <h2 className={h.name}>{ctf?.title}</h2>
            <p className={h.lead}>Zadanie Capture the flag: znajdź flagę, zanim zrobi to ktoś inny.</p>
          </>
        )}
        {pick && <span className={h.timer}><Timer size={15} aria-hidden="true" />Kończy się za <b>{left}</b></span>}
      </div>
      <Link to="/quests" className={h.cta}>Wszystkie questy<ArrowRight size={18} aria-hidden="true" /></Link>
    </section>
  );
}
