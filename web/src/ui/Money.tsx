import CounterJs from './reactbits/Counter/Counter';
import { baseTheme } from '../styles/theme';
import styles from './Money.module.css';

/** Motyw Warm (i Niepodległość) pisze liczby szeryfem ze starymi cyframi: ogonki (4, 5, 7, 9) z sąsiedniego wiersza paska cyfr wystawałyby do okienka i
 *  zostawiały zabłąkane piksele nad liczbą, więc wiersze dostają odstęp (prop `padding` Countera ustawia --counter-padding w stylu elementu) */
const PAD = baseTheme() === 'warm' ? 7 : 0;

const Counter = CounterJs as any;

/** Kwota w groszach: cyfry przewijają się przy każdej zmianie salda */
export function Money({ value }: { value: number }) {
  return (
    <span className={styles.money} aria-label={`${Math.round(value)} groszy`}>
      <Counter value={Math.round(value)} locale="pl-PL" intro={false} motionBlur={false} duration={0.55} fade={0} padding={PAD} fontSize="inherit" fontWeight="inherit" />
      <small className={styles.unit}>gr</small>
    </span>
  );
}
