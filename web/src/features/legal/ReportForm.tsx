import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { REPORT_CATEGORIES } from './useLegal';
import s from './legal.module.css';

interface Props {
  /** karta z podglądu w grze; bez niej (strona /zglos) trzeba wpisać nazwę karty */
  pid?: string;
  variant?: string;
  cardLabel?: string;
  onDone?: () => void;
}

const MAX = 2000;

/** Formularz zgłoszenia problemu z kartą: w oknie gry i na publicznej stronie /zglos (bez konta) */
export function ReportForm({ pid, variant, cardLabel, onDone }: Props) {
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const cat = REPORT_CATEGORIES.find(c => c.id === category);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (!category) return setError('Wybierz rodzaj problemu');
    setBusy(true);
    setError('');
    try {
      await api('/api/reports', { person: pid ?? '', variant: variant ?? '', cardName: f.cardName ?? '', category, message, contact: f.contact ?? '', leaveEmpty: f.leave_empty ?? '' });
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  };

  if (sent) {
    return (
      <div className={s.done} role="status">
        <b>Dziękujemy, zgłoszenie dotarło.</b>
        <p className="muted">Przeczytamy je i rozpatrzymy, zwykle w ciągu 14 dni.{cat?.needsContact && ' Odpowiemy na podany adres e-mail.'}</p>
        {onDone && <Button kind="hue" onClick={onDone}>Zamknij</Button>}
      </div>
    );
  }

  return (
    <form className={s.form} onSubmit={submit}>
      {cardLabel && <p className={s.cardRef}>Karta: <b>{cardLabel}</b></p>}
      <fieldset className={s.cats}>
        <legend>Co jest nie tak?</legend>
        {REPORT_CATEGORIES.map(c => (
          <label key={c.id} className={s.cat}>
            <input type="radio" name="category" value={c.id} checked={category === c.id} onChange={() => { setCategory(c.id); setError(''); }} />
            <span>{c.label}</span>
          </label>
        ))}
      </fieldset>

      {!pid && <label>Której karty dotyczy zgłoszenie?<input type="text" name="cardName" maxLength={100} required placeholder="np. nazwa osoby lub postaci z karty" /></label>}

      <label>
        Opis
        <textarea value={message} onChange={e => setMessage(e.target.value)} required minLength={10} maxLength={MAX}
          placeholder={category === 'likeness' ? 'Napisz, kim jesteś w stosunku do osoby z karty i czego oczekujesz: usunięcia czy zmiany karty.' : 'Opisz problem tak dokładnie, jak potrafisz.'} />
        <span className={s.count}>{message.length}/{MAX}</span>
      </label>

      <label>
        {cat?.needsContact ? 'Twój e-mail (potrzebny, żeby odpowiedzieć)' : 'Twój e-mail (opcjonalnie, jeśli chcesz odpowiedź)'}
        <input type="email" name="contact" maxLength={120} required={!!cat?.needsContact} autoComplete="email" />
      </label>

      <div className={s.hp} aria-hidden="true"><label>Zostaw to pole puste<input type="text" name="leave_empty" tabIndex={-1} autoComplete="off" /></label></div>

      <p className={s.err} role="alert">{error}</p>
      <div className={s.actions}>
        <Button kind="hue" big type="submit" disabled={busy}>Wyślij zgłoszenie</Button>
        {onDone && <Button big onClick={onDone}>Anuluj</Button>}
      </div>
      <p className="muted small">Dane ze zgłoszenia służą tylko do jego rozpatrzenia. Więcej w <a href="/prywatnosc" target="_blank" rel="noopener">Polityce prywatności</a>.</p>
    </form>
  );
}
