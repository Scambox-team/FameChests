import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flashlight, Maximize, Play, TriangleAlert } from 'lucide-react';
import { Sound } from '../../sound/sound';
import { hasWebGL, setUser3DOff, use3D } from '../../three/support';
import type { Horror3D } from '../../three/horrorScene';
import { Button } from '../../ui/Button';
import { clock, readBest } from './best';
import './horror.css';
import './hz3.css';

// Zakładka Gry -> Mgła (/games/mgla): horror 3D (three/horrorScene.ts, potwór w three/horrorMonster.ts).
// Strona przed grą pasuje do motywów; sama gra leży w kontenerze `.hz3` przeniesionym do <body> (portal) i po kliknięciu „Graj”
// przechodzi w pełny ekran (Fullscreen API wymaga kliknięcia, więc scenę tworzymy synchronicznie w obsłudze kliknięcia -
// moduł sceny wczytujemy wcześniej). Bez pełnego ekranu kontener i tak zakrywa całe okno. „Wyjdź z gry” wraca tutaj.
// Bez nagród (grosze, karty, EXP): rekord tylko w localStorage (best.ts).
type SceneModule = typeof import('../../three/horrorScene');

export function HorrorPage() {
  const on = use3D();
  const shell = useRef<HTMLDivElement>(null);
  const mod = useRef<SceneModule | null>(null);
  const game = useRef<Horror3D | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [best, setBest] = useState(readBest);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    import('../../three/horrorScene').then(m => { if (alive) { mod.current = m; setReady(true); } }).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      game.current?.destroy(); game.current = null;
      document.documentElement.classList.remove('hz3-open');
    };
  }, [on]);

  const exit = () => {
    game.current?.destroy(); game.current = null;
    if (shell.current) shell.current.hidden = true;
    document.documentElement.classList.remove('hz3-open');
    setPlaying(false);
    setBest(readBest());
  };
  const play = () => {
    const el = shell.current, m = mod.current;
    if (!el || !m || game.current) return;
    Sound.click();
    el.hidden = false;
    document.documentElement.classList.add('hz3-open');
    try {
      game.current = m.createHorror3D(el, { volume: () => Sound.volume, soundOn: () => Sound.enabled, onExit: exit });
      game.current.start();
      setPlaying(true);
    } catch {
      exit();
      setFailed(true);   // WebGL nie wystartował mimo wykrycia
    }
  };

  if (!on || failed) return (
    <div className="panel fl-off">
      <h3>Ta gra wymaga grafiki 3D</h3>
      <p className="muted">{failed ? 'Nie udało się uruchomić grafiki 3D w tej przeglądarce.' : 'Grafika 3D jest wyłączona w ustawieniach (albo przeglądarka nie obsługuje WebGL).'}</p>
      {hasWebGL() && !failed && <Button kind="hue" onClick={() => { setUser3DOff(false); location.reload(); }}>Włącz grafikę 3D</Button>}
    </div>
  );

  return (
    <div className="hz-page">
      <section className="hz-poster" aria-label="Mgła">
        <div className="hz-trees" aria-hidden="true" />
        <div className="hz-figure" aria-hidden="true" />
        <div className="hz-lines" aria-hidden="true" />
        <div className="hz-osd" aria-hidden="true"><span><i />REC</span><span>18.11.1996</span></div>
        <div className="hz-title">
          <h2>Mgła</h2>
          <p>Las nocą, latarka i sześć kaset VHS. Zbierz je wszystkie i uciekaj bramą. Coś idzie za tobą.</p>
          <button type="button" className="hz-play" onClick={play} disabled={!ready || playing}>
            <Play size={18} aria-hidden="true" /> {ready ? 'Graj' : 'Wczytuję'}
          </button>
          <small><Maximize size={13} aria-hidden="true" /> Gra uruchamia się na pełnym ekranie</small>
        </div>
      </section>
      <aside className="hz-side">
        <div className="panel hz-help">
          <h3>Sterowanie</h3>
          <p><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> albo strzałki: ruch, mysz: rozglądanie się, <kbd>Shift</kbd> bieg, <kbd>F</kbd> latarka, <kbd>Esc</kbd> pauza</p>
          <p className="muted small">Na telefonie: lewa połowa ekranu to joystick, prawą przeciągasz, żeby się rozglądać. Przyciski latarki, biegu i pauzy są na ekranie gry.</p>
          <h3>Zasady</h3>
          <ul>
            <li>Kasety leżą na pieńkach w zakamarkach lasu. Gdy jesteś blisko, słychać buczenie taśmy z jej strony.</li>
            <li>Każda zebrana kaseta przyspiesza potwora. Światło latarki go spowalnia, ale bateria się wyczerpuje.</li>
            <li>Bieg męczy: gdy skończy się kondycja, przez chwilę idziesz wolniej.</li>
            <li>Po ostatniej kasecie otwiera się brama. Szukaj czerwonego światła i sygnału z jego strony.</li>
          </ul>
          <h3>Rekord</h3>
          <p className="hz-best"><Flashlight size={16} aria-hidden="true" />
            <span>Kasety: <b>{best.tapes} / 6</b>{best.escape != null && <>, najszybsza ucieczka: <b>{clock(best.escape)}</b></>}</span></p>
          <p className="muted small">Rekord zapisuje się tylko w tej przeglądarce. Za tę grę nie ma nagród.</p>
        </div>
        <p className="hz-warn"><TriangleAlert size={16} aria-hidden="true" /> Gra zawiera nagłe straszne sceny i migające zakłócenia obrazu. Przy ograniczonym ruchu albo w trybie wydajności są łagodniejsze.</p>
      </aside>
      {createPortal(<div ref={shell} className="hz3" hidden={!playing} role="application" aria-label="Mgła" />, document.body)}
    </div>
  );
}
