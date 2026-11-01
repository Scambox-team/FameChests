import CounterJs from './reactbits/Counter/Counter';
import styles from './Money.module.css';

const Counter = CounterJs as any;

/** Kwota w groszach: cyfry przewijają się przy każdej zmianie salda */
export function Money({ value }: { value: number }) {
  return (
    <span className={styles.money} aria-label={`${Math.round(value)} groszy`}>
      <Counter value={Math.round(value)} locale="pl-PL" intro={false} motionBlur={false} duration={0.55} fade={0} fontSize="inherit" fontWeight="inherit" />
      <small className={styles.unit}>gr</small>
    </span>
  );
}
