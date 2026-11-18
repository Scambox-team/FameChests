import { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useGame } from '../../game/store';
import { PageHero } from '../../ui/PageHero';
import { CtfDialog, CtfSlide } from '../home/CtfQuest';
import { WantedSlide } from '../home/QuestTile';
import h from '../home/home.module.css';
import { PiggyQuestPanel } from './Piggy';
import s from './quests.module.css';

// Zakładka Questy (/quests): kafelki jak na stronie startowej. Pierwszy, szeroki kafelek to Skarbonka (quest główny, wspólny
// cel), niżej w rzędzie: Wanted i CTF (te same widoki co dawniej na stronie startowej).
export function QuestsPage() {
  const { quest, ctf } = useGame();
  const [ctfOpen, setCtfOpen] = useState(false);
  useEffect(() => { document.title = 'Questy - ScamBox'; }, []);
  return (
    <div className={s.page}>
      <PageHero icon={ScrollText} title="Questy" lead="Wspólna skarbonka dla wszystkich graczy i zadania, w których wygrywa najszybszy." />
      <div className={h.tiles}>
        <div className={s.wide}><PiggyQuestPanel /></div>
        <section className={`${h.tile} ${h.quest} ${s.qTile}`} aria-label="Quest Wanted">
          <div className={h.qTrack}><div className={h.qSlide}><WantedSlide quest={quest} /></div></div>
        </section>
        {ctf && (
          <section className={`${h.tile} ${h.quest} ${h.questCtf} ${s.qTile}`} aria-label="Quest Capture the flag">
            <div className={h.qTrack}><div className={h.qSlide}><CtfSlide onOpen={() => setCtfOpen(true)} /></div></div>
          </section>
        )}
      </div>
      {ctfOpen && <CtfDialog onClose={() => setCtfOpen(false)} />}
    </div>
  );
}
