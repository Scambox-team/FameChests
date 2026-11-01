import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import styles from './Field.module.css';

export function SearchField({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`${styles.search} ${className}`}>
      <Search size={16} strokeWidth={1.7} aria-hidden="true" />
      <input type="search" autoComplete="off" {...rest} />
    </label>
  );
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <span className={`${styles.select} ${className}`}>
      <select {...rest}>{children}</select>
      <ChevronDown size={16} aria-hidden="true" />
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; count?: number; disabled?: boolean }[]; label: string }) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {items.map(i => (
        <button key={i.id} type="button" role="tab" aria-selected={value === i.id} disabled={i.disabled} onClick={() => onChange(i.id)}>
          {i.label}{i.count !== undefined && <small>{i.count}</small>}
        </button>
      ))}
    </div>
  );
}
