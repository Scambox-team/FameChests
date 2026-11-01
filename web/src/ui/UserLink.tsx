import { Link } from 'react-router-dom';
import { vClass } from '../game/rules';
import { S } from '../game/store';
import styles from './UserLink.module.css';

export interface UserRef { username: string; avatarCard?: string | null; avatarRarity?: string | null; avatarVariant?: string | null }

/** Ikona gracza: zdjęcie jego karty albo pierwsza litera nazwy */
export function Avatar({ user, size = 26 }: { user: UserRef; size?: number }) {
  if (user.avatarCard) {
    const rc = S.cfg?.rarities[user.avatarRarity ?? '']?.color || '#ffffff55';
    return (
      <span className={`av-card ${vClass(user.avatarVariant, 'avv-')}${user.avatarRarity === 'secret' ? ' av-secret' : ''} ${styles.ava}`} style={{ '--rc': rc, width: size, height: size } as React.CSSProperties}>
        <img src={`/avatar/${encodeURIComponent(user.username)}?c=${encodeURIComponent(user.avatarCard)}`} alt="" draggable={false} />
      </span>
    );
  }
  return <span className={styles.letter} style={{ width: size, height: size, fontSize: size * .45 }} aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>;
}

export function UserLink({ user }: { user: UserRef }) {
  const to = `/player/${encodeURIComponent(user.username)}`;
  const inner = <><Avatar user={user} /><span>{user.username}</span></>;
  return <Link className={styles.link} to={to}>{inner}</Link>;
}
