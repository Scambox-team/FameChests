import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sound } from '../../sound/sound';
import './casino-intro.css';

// Intro przed ekranem kasyna: GIF na cały ekran, potem znika i widać kasyno (pod spodem już się wczytuje).
// Każde wejście pokazuje GIF od pierwszej klatki: plik pobieramy raz, a każde wejście dostaje nowy adres blob:
// (ten sam adres przeglądarka odtwarza dalej od miejsca, w którym animacja była).
const SRC = '/static/img/casino_intro.gif';
const PLAY_MS = 2000;   // długość GIF-a
const FADE_MS = 450;

let blob: Promise<Blob | null> | null = null;
const load = () => (blob ??= fetch(SRC).then(r => (r.ok ? r.blob() : null)).catch(() => null));
export const preloadCasinoIntro = () => { load(); };

export function CasinoIntro({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [out, setOut] = useState(false);

  useEffect(() => {
    let alive = true, made = '';
    const fail = setTimeout(() => alive && onDone(), 2500);   // GIF się nie wczytał - nie trzymamy gracza
    load().then(b => {
      if (!alive) return;
      if (!b) return onDone();
      clearTimeout(fail);
      made = URL.createObjectURL(b);
      setUrl(made);
    });
    return () => { alive = false; clearTimeout(fail); if (made) URL.revokeObjectURL(made); };
  }, [onDone]);

  useEffect(() => {
    if (!url) return;
    Sound.dice();
    const a = setTimeout(() => setOut(true), PLAY_MS);
    const b = setTimeout(onDone, PLAY_MS + FADE_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [url, onDone]);

  useEffect(() => {
    const skip = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') onDone(); };
    document.addEventListener('keydown', skip);
    return () => document.removeEventListener('keydown', skip);
  }, [onDone]);

  return createPortal(
    <div className={`cs-intro${out ? ' out' : ''}${url ? ' on' : ''}`} onClick={onDone} role="presentation" aria-hidden="true">
      {url && <img src={url} alt="" draggable={false} />}
    </div>,
    document.body
  );
}
