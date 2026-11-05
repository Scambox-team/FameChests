import { useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { lang, setLang } from '../i18n/i18n';
import { Sound } from '../sound/sound';
import styles from './Settings.module.css';

/** Dźwięk: ikona otwiera okienko z suwakiem głośności, wyciszeniem i wyborem języka (zapamiętane w przeglądarce) */
export function SoundControl({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(Sound.enabled);
  const [vol, setVol] = useState(Math.round(Sound.volume * 100));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  const Icon = !on || vol === 0 ? VolumeX : vol < 50 ? Volume1 : Volume2;
  const change = (v: number) => {
    setVol(v);
    Sound.setVolume(v / 100);
    if (v > 0 && !Sound.enabled) setOn(Sound.toggle());
  };
  return (
    <div className={styles.wrap} ref={box}>
      <button className={className} type="button" aria-label="Dźwięk i głośność" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon size={17} strokeWidth={1.6} />
      </button>
      {open && (
        <div className={styles.pop} role="dialog" aria-label="Dźwięk i głośność">
          <div className={styles.row}>
            <b>Głośność</b>
            <span>{on ? `${vol}%` : 'Wyciszone'}</span>
          </div>
          <input type="range" min={0} max={100} step={5} value={vol} aria-label="Głośność" disabled={!on}
            onChange={e => change(+e.target.value)} onPointerUp={() => Sound.click()} />
          <label className={styles.mute}>
            <input type="checkbox" checked={!on} onChange={() => setOn(Sound.toggle())} />Wycisz grę
          </label>
          <div className={`${styles.row} ${styles.langRow}`}><b>Język</b><LangSwitch /></div>
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
