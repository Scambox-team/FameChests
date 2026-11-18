import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CassetteTape, DoorOpen, Ear, Eye, Fan, FlaskConical, Flashlight, Footprints, Keyboard, Maximize, Play, Skull, Smartphone, TriangleAlert, Trophy } from 'lucide-react';
import { Sound } from '../../sound/sound';
import { hasWebGL, setUser3DOff, use3D } from '../../three/support';
import type { Horror3D } from '../../three/horrorScene';
import { Button } from '../../ui/Button';
import { clock, readBest } from './best';
import './horror.css';
import './hz3.css';

// Zakładka Gry -> ScamRooms (/games/scamrooms): horror 3D (three/horrorScene.ts, potwór w three/horrorMonster.ts).
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
  const tc = useRef<HTMLElement>(null);

  // licznik taśmy w rogu plakatu (jak w odtwarzaczu VHS)
  useEffect(() => {
    let t = 0;
    const id = window.setInterval(() => {
      t++;
      if (tc.current) tc.current.textContent = `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    }, 1000);
    return () => clearInterval(id);
  }, []);

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
      <section className="hz-hero" aria-label="ScamRooms">
        <div className="hz-tunnel" aria-hidden="true">
          <div className="hz-cam"><i className="hz-floor" /><i className="hz-ceil" /><i className="hz-left" /><i className="hz-right" /></div>
        </div>
        <div className="hz-fog" aria-hidden="true"><b className="hz-figure" /></div>
        <div className="hz-vhs" aria-hidden="true" />
        <div className="hz-osd" aria-hidden="true">
          <span className="hz-rec"><i />REC</span>
          <span className="hz-tape"><Play size={13} fill="currentColor" /> PLAY <b ref={tc}>0:00:00</b></span>
          <span>18.11.1996</span>
        </div>
        <div className="hz-title">
          <p className="hz-kicker">Znaleziona taśma · Poziom 0</p>
          <div className="hz-name"><h2 data-text="ScamRooms">ScamRooms</h2><span className="hz-beta">Beta</span></div>
          <p className="hz-betanote"><FlaskConical size={16} aria-hidden="true" /> Wersja beta: na razie w ScamRooms nie zarabiasz groszy i nie zdobywasz kart. Gra może się jeszcze zmieniać.</p>
          <p className="hz-lead">Opuszczony budynek bez końca, za każdym razem inny. Latarka i sześć kaset VHS. Zbierz je wszystkie i uciekaj drzwiami z napisem WYJŚCIE. Coś tam krąży.</p>
          <div className="hz-cta">
            <button type="button" className="hz-play" onClick={play} disabled={!ready || playing}>
              <Play size={18} fill="currentColor" aria-hidden="true" /> {ready ? 'Graj' : 'Wczytuję'}
            </button>
            <small><Maximize size={13} aria-hidden="true" /> Pełny ekran, najlepiej ze słuchawkami</small>
          </div>
        </div>
      </section>
      <div className="hz-cards">
        <section className="panel hz-card">
          <h3><Keyboard size={18} aria-hidden="true" /> Sterowanie</h3>
          <dl className="hz-keys">
            <div><dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>Ruch (albo strzałki)</dd></div>
            <div><dt><kbd>Mysz</kbd></dt><dd>Rozglądanie się</dd></div>
            <div><dt><kbd>Shift</kbd></dt><dd>Bieg</dd></div>
            <div><dt><kbd>Spacja</kbd></dt><dd>Skok</dd></div>
            <div><dt><kbd>C</kbd></dt><dd>Kucanie</dd></div>
            <div><dt><kbd>F</kbd></dt><dd>Latarka (albo prawy przycisk myszy)</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>Pauza</dd></div>
          </dl>
          <p className="muted small hz-phone"><Smartphone size={15} aria-hidden="true" /> Na telefonie: lewa połowa ekranu to joystick, prawą przeciągasz, żeby się rozglądać. Przyciski są na ekranie gry.</p>
        </section>
        <section className="panel hz-card">
          <h3><Skull size={18} aria-hidden="true" /> Jak przetrwać</h3>
          <ul className="hz-rules">
            <li><CassetteTape size={17} aria-hidden="true" /><span>Kasety leżą w zakamarkach, na szafkach (podskocz), w kanałach, na dnie basenów i w łazienkach. Najbliższa buczy z jej strony.</span></li>
            <li><Eye size={17} aria-hidden="true" /><span>Potwór nie wie, gdzie jesteś. Widzi tylko przed sobą: z zapaloną latarką z daleka, w kucki z bliska.</span></li>
            <li><Ear size={17} aria-hidden="true" /><span>Słyszy kroki: bieg, lądowanie i chlapanie w wodzie z daleka, kucanie wcale. Od tyłu podejdziesz go tylko w kucki.</span></li>
            <li><Footprints size={17} aria-hidden="true" /><span>Gdy cię zobaczy, goni, dopóki nie znikniesz mu z oczu. Bieg i skoki męczą.</span></li>
            <li><Flashlight size={17} aria-hidden="true" /><span>Światło latarki go spowalnia, ale bateria się wyczerpuje. Każda kaseta go przyspiesza.</span></li>
            <li><Fan size={17} aria-hidden="true" /><span>Kanały wentylacyjne przejdziesz w kucki, a potwór musi iść naokoło. Barykady z kartonów da się przeskoczyć.</span></li>
            <li><DoorOpen size={17} aria-hidden="true" /><span>Po ostatniej kasecie otwierają się drzwi z czerwonym napisem WYJŚCIE.</span></li>
          </ul>
        </section>
        <section className="panel hz-card">
          <h3><Trophy size={18} aria-hidden="true" /> Rekord</h3>
          <div className="hz-stats">
            <div><b>{best.tapes}<small> / 6</small></b><span>najwięcej kaset</span></div>
            <div><b>{best.escape != null ? clock(best.escape) : 'brak'}</b><span>najszybsza ucieczka</span></div>
          </div>
          <p className="muted small">Rekord zapisuje się tylko w tej przeglądarce. ScamRooms jest w wersji beta: na razie nie daje groszy ani kart.</p>
          <p className="hz-warn"><TriangleAlert size={16} aria-hidden="true" /> Gra zawiera nagłe straszne sceny i migające zakłócenia obrazu. Przy ograniczonym ruchu albo w trybie wydajności są łagodniejsze.</p>
        </section>
      </div>
      {createPortal(<div ref={shell} className="hz3" hidden={!playing} role="application" aria-label="ScamRooms" />, document.body)}
    </div>
  );
}
