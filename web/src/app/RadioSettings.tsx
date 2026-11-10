import { ExternalLink, Pause, Play, Radio as RadioIcon, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { Sound } from '../sound/sound';
import {
  next, prev, setRadioAlbum, setRadioMode, setRadioMuted, setRadioOn, setRadioVolume, toggleRadioPause, useRadio, type RadioTrack,
} from '../sound/radio';
import styles from './Settings.module.css';

/** Źródło utworu: tekst, a gdy admin podał adres, to link */
function Credit({ t }: { t: RadioTrack }) {
  if (!t.credit && !t.sourceUrl) return <span>Źródło: brak informacji</span>;
  const text = t.credit || t.sourceUrl;
  return (
    <span>
      Źródło:{' '}
      {t.sourceUrl
        ? <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer">{text}<ExternalLink size={11} strokeWidth={2} aria-hidden="true" /></a>
        : text}
    </span>
  );
}

/** Radio w Ustawieniach -> Eksperymentalne: włączenie, album, tryb, głośność i wyciszenie samej muzyki, sterowanie i źródła */
export function RadioSettings() {
  const r = useRadio();
  const album = r.albums.find(a => a.id === r.albumId) ?? null;
  const empty = r.loaded && r.albums.length === 0;
  return (
    <div className={styles.radio}>
      <label className={styles.check}>
        <input type="checkbox" checked={r.on} disabled={empty} onChange={e => setRadioOn(e.target.checked)} />
        <span>
          <b><RadioIcon size={14} strokeWidth={1.8} aria-hidden="true" className={styles.lock} /> Radio</b>
          <small>{empty ? 'Radio jest puste: administracja nie dodała jeszcze żadnego albumu.' : 'Muzyka z albumów gry, grana w pętli.'}</small>
        </span>
      </label>
      {r.on && album && (
        <>
          <label className={styles.field}>
            <span>Album</span>
            <select value={album.id} onChange={e => setRadioAlbum(+e.target.value)}>
              {r.albums.map(a => <option key={a.id} value={a.id}>{a.name} ({a.tracks.length})</option>)}
            </select>
          </label>
          {album.description && <small className={styles.hint}>{album.description}</small>}
          <fieldset className={styles.themes}>
            <legend>Kolejność</legend>
            <label className={styles.check}>
              <input type="radio" name="radioMode" checked={r.mode === 'shuffle'} onChange={() => setRadioMode('shuffle')} />
              <span><b>Losowo</b></span>
            </label>
            <label className={styles.check}>
              <input type="radio" name="radioMode" checked={r.mode === 'order'} onChange={() => setRadioMode('order')} />
              <span><b>Po kolei</b></span>
            </label>
          </fieldset>
          <div className={styles.row}>
            <b>Głośność muzyki</b>
            <span>{r.muted ? 'Wyciszona' : `${Math.round(r.volume * 100)}%`}</span>
          </div>
          <input type="range" min={0} max={100} step={5} value={Math.round(r.volume * 100)} aria-label="Głośność muzyki"
            disabled={r.muted} onChange={e => setRadioVolume(+e.target.value / 100)} />
          <label className={styles.check}>
            <input type="checkbox" checked={r.muted} onChange={e => setRadioMuted(e.target.checked)} />
            <span>
              <b>{r.muted ? <VolumeX size={14} aria-hidden="true" className={styles.lock} /> : <Volume2 size={14} aria-hidden="true" className={styles.lock} />} Wycisz muzykę</b>
              <small>{Sound.enabled ? 'Efekty dźwiękowe grają dalej.' : 'Cała gra jest wyciszona, więc radio też milczy.'}</small>
            </span>
          </label>
          <div className={styles.transport} role="group" aria-label="Sterowanie radiem">
            <button type="button" onClick={prev} aria-label="Poprzedni utwór"><SkipBack size={16} /></button>
            <button type="button" onClick={toggleRadioPause} aria-label={r.playing ? 'Pauza' : 'Graj'}>{r.playing ? <Pause size={16} /> : <Play size={16} />}</button>
            <button type="button" onClick={next} aria-label="Następny utwór"><SkipForward size={16} /></button>
          </div>
          {r.blocked && <small className={styles.hint}>Przeglądarka czeka na kliknięcie: kliknij cokolwiek na stronie, a muzyka ruszy.</small>}
          {r.track && (
            <div className={styles.now} aria-live="polite">
              <b>{r.track.title}</b>
              <Credit t={r.track} />
            </div>
          )}
          <details className={styles.credits}>
            <summary>Źródła utworów z albumu</summary>
            <ul>
              {album.tracks.map(t => <li key={t.id}><b>{t.title}</b><Credit t={t} /></li>)}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
