import { useEffect, useRef, useState } from 'react';
import { FlaskConical, Volume1, Volume2, VolumeX } from 'lucide-react';
import { lang, setLang } from '../i18n/i18n';
import { Sound } from '../sound/sound';
import { getTheme, setTheme } from '../styles/theme';
import { hasWebGL, setUser3DOff, user3DOff } from '../three/support';
import styles from './Settings.module.css';

/** Zawartość ustawień: dźwięk, język, grafika 3D i funkcje eksperymentalne (zapamiętane w przeglądarce).
 *  Pokazuje ją okienko pod ikoną w pasku bocznym oraz arkusz „Więcej” na telefonie. */
export function SettingsPanel({ className }: { className?: string }) {
  const [on, setOn] = useState(Sound.enabled);
  const [vol, setVol] = useState(Math.round(Sound.volume * 100));
  const [y2k, setY2k] = useState(() => getTheme() === 'y2k');
  const webgl = hasWebGL();

  const change = (v: number) => {
    setVol(v);
    Sound.setVolume(v / 100);
    if (v > 0 && !Sound.enabled) setOn(Sound.toggle());
  };
  // sceny 3D powstają przy wejściu na ekran, więc zmiana przeładowuje stronę (po potwierdzeniu)
  const toggle3d = (want: boolean) => {
    if (!confirm('Zmiana grafiki 3D przeładuje stronę. Kontynuować?')) return;
    setUser3DOff(!want);
    location.reload();
  };
  const toggleY2k = (want: boolean) => { setY2k(want); setTheme(want ? 'y2k' : 'default'); };

  return (
    <div className={`${styles.body} ${className ?? ''}`}>
      <div className={styles.row}>
        <b>Głośność</b>
        <span>{on ? `${vol}%` : 'Wyciszone'}</span>
      </div>
      <input type="range" min={0} max={100} step={5} value={vol} aria-label="Głośność" disabled={!on}
        onChange={e => change(+e.target.value)} onPointerUp={() => Sound.click()} />
      <label className={styles.check}>
        <input type="checkbox" checked={!on} onChange={() => setOn(Sound.toggle())} />Wycisz grę
      </label>
      <div className={`${styles.row} ${styles.sep}`}><b>Język</b><LangSwitch /></div>
      <div className={styles.sep}>
        <label className={styles.check}>
          <input type="checkbox" checked={!user3DOff() && webgl} disabled={!webgl} onChange={e => toggle3d(e.target.checked)} />
          <span><b>Grafika 3D</b><small>{webgl ? 'Wyłącz, jeśli gra działa wolno. Zostaną płaskie wersje.' : 'Twoja przeglądarka nie obsługuje WebGL.'}</small></span>
        </label>
      </div>
      <div className={styles.sep}>
        <div className={styles.group}><FlaskConical size={14} strokeWidth={1.8} aria-hidden="true" />Eksperymentalne</div>
        <label className={styles.check}>
          <input type="checkbox" checked={y2k} onChange={e => toggleY2k(e.target.checked)} />
          <span><b>Motyw Y2K</b><small>Róż, brokat i kanciaste krawędzie.</small></span>
        </label>
      </div>
    </div>
  );
}

/** Ustawienia: ikona otwiera okienko (pasek boczny na komputerze) */
export function SoundControl({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  const vol = Sound.volume * 100;
  const Icon = !Sound.enabled || vol === 0 ? VolumeX : vol < 50 ? Volume1 : Volume2;
  return (
    <div className={styles.wrap} ref={box}>
      <button className={className} type="button" aria-label="Ustawienia: dźwięk, język, grafika" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon size={17} strokeWidth={1.6} />
      </button>
      {open && (
        <div className={styles.pop} role="dialog" aria-label="Ustawienia">
          <SettingsPanel />
        </div>
      )}
    </div>
  );
}

/** Język gry: PL / EN (zmiana przeładowuje stronę) */
export function LangSwitch() {
  return (
    <div className={styles.lang} role="group" aria-label="Język">
      <button type="button" aria-pressed={lang === 'pl'} onClick={() => setLang('pl')} title="Polski">PL</button>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} title="English">EN</button>
    </div>
  );
}
