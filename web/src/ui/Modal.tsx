import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './Modal.module.css';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** bardzo duże okno (wybór kart) */
  huge?: boolean;
}

export function Modal({ title, onClose, children, wide, huge }: Props) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return createPortal(
    <div className={styles.back} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={`${styles.box}${wide ? ` ${styles.wide}` : ''}${huge ? ` ${styles.huge}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.head}>
          <h2>{title}</h2>
          <button className={styles.close} type="button" aria-label="Zamknij" onClick={onClose}><X size={18} strokeWidth={1.8} /></button>
        </header>
        {children}
      </section>
    </div>,
    document.body
  );
}
