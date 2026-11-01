import { useSyncExternalStore } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import styles from './Toaster.module.css';

interface Toast { id: number; msg: string; err: boolean }
let toasts: Toast[] = [], nextId = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export function toast(msg: string, err = false) {
  const t = { id: nextId++, msg, err };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => { toasts = toasts.filter(x => x !== t); emit(); }, 3100);
}

export function Toaster() {
  const list = useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => toasts);
  return (
    <div className={styles.box} role="status" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`${styles.toast}${t.err ? ` ${styles.err}` : ''}`}>
          {t.err ? <TriangleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
