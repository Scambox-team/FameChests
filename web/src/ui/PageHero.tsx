import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import styles from './PageHero.module.css';

interface Props {
  icon: LucideIcon;
  title: ReactNode;
  lead?: ReactNode;
  stats?: [string, ReactNode][];
  children?: ReactNode;
}

/** Nagłówek zakładki w stylu karty skrzynki: panel w kolorze wybranej skrzynki, tytuł, opis, liczby i ikona */
export function PageHero({ icon: Icon, title, lead, stats, children }: Props) {
  return (
    <section className={styles.hero}>
      <div className={styles.text}>
        <h2>{title}</h2>
        {lead && <p>{lead}</p>}
        {stats && stats.length > 0 && <dl className={styles.stats}>{stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        {children}
      </div>
      <Icon className={styles.icon} strokeWidth={1.2} aria-hidden="true" />
    </section>
  );
}
