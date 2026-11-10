import { useEffect, useRef, useState } from 'react';
import { FlaskConical, Lock, Volume1, Volume2, VolumeX } from 'lucide-react';
import { lang, setLang } from '../i18n/i18n';
import { Sound } from '../sound/sound';
import { getTheme, isDeepTheme, setTheme, type Theme } from '../styles/theme';
import { useGame } from '../game/store';
import { deepDefault2D, hasWebGL, setUser3DOff, user3DOff } from '../three/support';
import { casinoIntroOff, setCasinoIntroOff } from '../features/casino/introPref';
import { RadioSettings } from './RadioSettings';
import styles from './Settings.module.css';

/** Zawartość ustawień: dźwięk, język, grafika 3D i funkcje eksperymentalne (zapamiętane w przeglądarce).
 *  Pokazuje ją okienko pod ikoną w pasku bocznym oraz arkusz „Więcej” na telefonie. */
export function SettingsPanel({ className }: { className?: string }) {
  const [on, setOn] = useState(Sound.enabled);
  const [vol, setVol] = useState(Math.round(Sound.volume * 100));
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const game = useGame();
  const aeroOpen = game.themes.includes('aero');
  const indepOpen = game.themes.includes('independence');
  const [birds, setBirds] = useState(() => !casinoIntroOff());
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
  const pickTheme = (t: Theme) => {
    const prev = getTheme();
    setThemeState(t); setTheme(t);
    if (isDeepTheme(prev) || isDeepTheme(t)) location.reload();   // sceny 3D i układ czytają motyw przy starcie
  };
  const current: Theme = (theme === 'aero' && !aeroOpen) || (theme === 'independence' && !indepOpen) ? 'default' : theme;

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
          <span><b>Grafika 3D</b><small>{!webgl ? 'Twoja przeglądarka nie obsługuje WebGL.' : deepDefault2D() ? 'W tym motywie domyślnie wyłączona: gra pokazuje jego własne ilustracje 2D. Włącz, jeśli wolisz modele 3D.' : 'Wyłącz, jeśli gra działa wolno. Zostaną płaskie wersje.'}</small></span>
        </label>
      </div>
      <div className={styles.sep}>
        <div className={styles.group}><FlaskConical size={14} strokeWidth={1.8} aria-hidden="true" />Eksperymentalne</div>
        <fieldset className={styles.themes}>
          <legend>Motyw</legend>
          <label className={styles.check}>
            <input type="radio" name="theme" checked={current === 'default'} onChange={() => pickTheme('default')} />
            <span><b>Domyślny</b><small>Ciemny, spokojny wygląd gry.</small></span>
          </label>
          <label className={styles.check}>
            <input type="radio" name="theme" checked={current === 'y2k'} onChange={() => pickTheme('y2k')} />
            <span><b>Y2K</b><small>Róż, brokat i kanciaste krawędzie.</small></span>
          </label>
          <label className={`${styles.check} ${aeroOpen ? '' : styles.locked}`}>
            <input type="radio" name="theme" checked={current === 'aero'} disabled={!aeroOpen} onChange={() => pickTheme('aero')} />
            <span>
              <b>Frutiger Aero{!aeroOpen && <Lock size={13} strokeWidth={2} aria-hidden="true" className={styles.lock} />}</b>
              <small>{aeroOpen ? 'Błękit nieba, szkło i bąbelki.' : 'Odblokujesz po wylosowaniu karty w wariancie Frutiger Aero'}</small>
            </span>
          </label>
          <label className={styles.check}>
            <input type="radio" name="theme" checked={current === 'warm'} onChange={() => pickTheme('warm')} />
            <span><b>Warm Editorial</b><small>Kremowy papier, tusz, terakota i szeryfowe nagłówki.</small></span>
          </label>
          <label className={styles.check}>
            <input type="radio" name="theme" checked={current === 'vapor'} onChange={() => pickTheme('vapor')} />
            <span><b>Vaporwave</b><small>Neonowy zachód słońca, siatka, róż i błękit.</small></span>
          </label>
          {indepOpen && (
            <label className={styles.check}>
              <input type="radio" name="theme" checked={current === 'independence'} onChange={() => pickTheme('independence')} />
              <span><b>Niepodległość</b><small>Kraftowy papier, biel i czerwień, kotyliony i plakaty z 1918 roku. Motyw na święto, nie zostaje na zawsze.</small></span>
            </label>
          )}
        </fieldset>
        <label className={styles.check}>
          <input type="checkbox" checked={birds} onChange={e => { setBirds(e.target.checked); setCasinoIntroOff(!e.target.checked); }} />
          <span><b>Ptasia wróżba</b><small>Coś leci, zanim usiądziesz do stołu.</small></span>
        </label>
        <RadioSettings />
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
