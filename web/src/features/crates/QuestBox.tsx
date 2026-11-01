import { Target, Trophy } from 'lucide-react';
import { confetti } from '../../fx/effects';
import { imgUrl, person, variantName } from '../../game/rules';
import { S, touch, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import styles from './QuestBox.module.css';

/** Stan questa z /api/me; wygrana pokazuje się raz, także gdy karta wypadła na innym ekranie */
export function noteQuest(q: any) {
  if (JSON.stringify(S.quest ?? null) !== JSON.stringify(q ?? null)) { S.quest = q || null; touch(); }
  if (!q?.mine) return;
  const key = `questWon:${q.day}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch { /* powiadomimy jeszcze raz */ }
  toast(`Quest dnia wypełniony: ${person(q.wonPerson).name} w wariancie ${variantName('wanted')} i +${fmt(q.money)} są twoje`);
  Sound.win();
  confetti(['#ffcf3f', '#fff', '#c8402a'], 160);
}

export function QuestBox() {
  const { quest: q } = useGame();
  if (!q) return null;
  const who = q.wonPerson || q.person, reward = q.done ? q.money : q.reward;
  const target = q.person ? person(q.person).name : 'dowolną kartę';
  const photo = who ? (person(who).masked ? `/img/${who}` : imgUrl(who, null, true)) : null;
  return (
    <section className={styles.box} aria-label="Quest dnia">
      <span className={styles.thumb}>{photo ? <img src={photo} alt="" /> : <Target size={20} aria-hidden="true" />}</span>
      <div className={styles.body}>
        <b>Quest dnia</b>
        <p>Zdobądź {target}{q.variant ? ` w wariancie ${variantName(q.variant)}` : ''}. Kto pierwszy, ten wygrywa.</p>
        <small className="muted">Nagroda: ta karta w wariancie {variantName('wanted')}{reward ? ` + ${fmt(reward)}` : ' + jej wartość w groszach'}. Liczą się skrzynki, kuźnia, ulepszacz i kasyno.</small>
      </div>
      {q.done && (q.mine
        ? <span className={styles.won}><Trophy size={16} aria-hidden="true" />Quest jest twój, +{fmt(q.money)}</span>
        : <span className="muted small">Quest przepadł. Wygrana: {q.winner || 'nieznany gracz'}</span>)}
    </section>
  );
}
