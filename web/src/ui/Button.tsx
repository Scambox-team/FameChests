import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: 'plain' | 'hue' | 'quiet';
  big?: boolean;
}

export function Button({ kind = 'plain', big, className = '', type = 'button', ...rest }: Props) {
  return <button type={type} className={`${styles.btn} ${styles[kind]}${big ? ` ${styles.big}` : ''} ${className}`} {...rest} />;
}
