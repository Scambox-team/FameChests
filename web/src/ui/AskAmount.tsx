import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import styles from './AskAmount.module.css';

interface Props { title: string; children: ReactNode; min: number; value: number; ok: string; onClose: (v: number | null) => void }

/** Okienko z kwotą: propozycja ceny, licytacja */
export function AskAmount({ title, children, min, value, ok, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return (
    <Modal title={title} onClose={() => onClose(null)}>
      <div className="muted">{children}</div>
      <form className={styles.form} onSubmit={e => { e.preventDefault(); onClose(+input.current!.value); }}>
        <input ref={input} type="number" min={min} defaultValue={value} required aria-label="Kwota" />
        <Button kind="hue" type="submit">{ok}</Button>
        <Button onClick={() => onClose(null)}>Anuluj</Button>
      </form>
    </Modal>
  );
}
