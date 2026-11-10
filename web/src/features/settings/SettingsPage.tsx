import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { SettingsPanel } from '../../app/Settings';
import { useGame } from '../../game/store';
import { DiscordLink } from './DiscordLink';
import styles from './settings.module.css';

/** Strona `/ustawienia`: dźwięk, język, grafika 3D i funkcje eksperymentalne (motyw Y2K) w jednym miejscu,
 *  osiągalna z paska bocznego i z arkusza „Więcej” na telefonie. Hasło i email są w profilu gracza. */
export function SettingsPage() {
  const game = useGame();
  return (
    <section className={styles.page}>
      <div className={styles.box}>
        <SettingsPanel />
      </div>
      <DiscordLink />
      <Link className={styles.account} to={`/player/${encodeURIComponent(game.me?.username ?? '')}`}>
        <KeyRound size={16} strokeWidth={1.8} aria-hidden="true" />
        Hasło i email zmienisz w swoim profilu
      </Link>
    </section>
  );
}
