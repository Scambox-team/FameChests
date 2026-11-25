import type { CSSProperties } from 'react';
import { useCosmeticSrc, type CosmeticView } from '../features/profile/cosmetics';
import { Avatar, type UserRef } from './UserLink';
import styles from './FramedAvatar.module.css';

/** Ikona gracza z obramówką (kosmetyk `frame`): obramówka 256 x 256 ma przezroczysty środek, zdjęcie leży pod nią i zajmuje ok. 70% szerokości.
 *  Bez obramówki to zwykły `Avatar` tej samej wielkości. */
export function FramedAvatar({ user, size, frame }: { user: UserRef; size: number; frame?: CosmeticView | null }) {
  const src = useCosmeticSrc(frame);
  if (!frame || !src) return <Avatar user={user} size={size} />;
  const inner = Math.round(size * 0.7);
  return (
    <span className={styles.fa} style={{ width: size, height: size } as CSSProperties}>
      <span className={styles.faIn}><Avatar user={user} size={inner} /></span>
      <img className={styles.faFrame} src={src} alt="" draggable={false} />
    </span>
  );
}
