// Motyw wyglądu: `localStorage.theme` = `y2k`, `aero`, `warm`, `vapor` albo `independence` ustawia `data-theme` na <html>
// (Niepodległość to odmiana Warm: data-theme="warm" + data-skin="independence", cały układ i sceny biorą się z Warm).
// Wywoływane jak najwcześniej (main.tsx i skrypt w index.html), żeby strona nie migała domyślnym motywem.
// Frutiger Aero jest zablokowany, dopóki serwer nie poda go w `themes` z /api/me (gracz wylosował kartę aero);
// Niepodległość jest czasowy: serwer podaje go w `themes` tylko w terminie ustawionym w panelu admina (routes/themes.rs).

export type Theme = 'default' | 'y2k' | 'aero' | 'warm' | 'vapor' | 'independence';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'y2k' || t === 'aero' || t === 'warm' || t === 'vapor' || t === 'independence' ? t : 'default';
  } catch { return 'default'; }
}

/** Motyw, z którego bierze się układ, sceny 3D i skórki gier: Niepodległość to Warm z inną paletą i motywami */
export const baseTheme = (t: Theme = getTheme()): Theme => (t === 'independence' ? 'warm' : t);

/** Motyw Warm Editorial pisze nagłówki szeryfem Newsreader: krój wczytujemy dopiero przy tym motywie (inni gracze nie płacą za niego ruchem) */
/** Krój Newsreader także dla kart (wariant Niepodległość): ta sama funkcja, wczytuje się raz */
export function warmFont() {
  if (document.getElementById('warmFont')) return;
  const l = document.createElement('link');
  l.id = 'warmFont'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,500;0,6..72,600;1,6..72,500;1,6..72,600&display=swap';
  document.head.appendChild(l);
}

/** Niepodległość pisze nagłówki krojem Playfair Display (wczytywany tylko przy tym motywie) */
function independenceFont() {
  if (document.getElementById('independenceFont')) return;
  const l = document.createElement('link');
  l.id = 'independenceFont'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&display=swap';
  document.head.appendChild(l);
}

/** Vaporwave pisze nagłówki szerokim krojem Michroma (wczytywany tylko przy tym motywie) */
function vaporFont() {
  if (document.getElementById('vaporFont')) return;
  const l = document.createElement('link');
  l.id = 'vaporFont'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Michroma&display=swap';
  document.head.appendChild(l);
}

export function applyTheme(t: Theme = getTheme()) {
  const d = document.documentElement.dataset;
  if (t === 'default') delete d.theme;
  else d.theme = baseTheme(t);
  if (t === 'independence') d.skin = 'independence'; else delete d.skin;
  if (t === 'warm' || t === 'independence') warmFont();   // Niepodległość: Newsreader zostaje na kartach wariantu
  if (t === 'independence') independenceFont();
  if (t === 'vapor') vaporFont();
}

/** Motywy, które zmieniają też sceny 3D i układ: przejście do nich albo z nich przeładowuje stronę (sceny czytają motyw raz) */
export const isDeepTheme = (t: Theme) => t === 'warm' || t === 'aero' || t === 'vapor' || t === 'independence';
/** Z głębokich motywów tylko Warm i Aero mają domyślnie wyłączone 3D (własne ilustracje 2D); Vaporwave ma neonowe 3D */
export const defaultsTo2D = (t: Theme) => t === 'warm' || t === 'aero' || t === 'independence';

/** Wybór gracza w Ustawieniach (także „Domyślny”) zapisuje się jawnie: bez wyboru motyw może być domyślnym motywem eventu (applyDefaultTheme) */
export function setTheme(t: Theme) {
  try { localStorage.setItem('theme', t); localStorage.removeItem('themeAuto'); } catch { /* bez zapamiętania */ }
  applyTheme(t);
}

/** Motyw domyślny na czas eventu (serwer: `themeDefault` z /api/me): dostają go tylko gracze, którzy nigdy nie wybrali motywu. Zapisuje się
 *  jako „automatyczny” (`themeAuto`), więc po evencie gracz wraca do zwykłego domyślnego (enforceThemes), a własny wybór zawsze wygrywa. */
export function applyDefaultTheme(offer: string | null | undefined) {
  if (offer !== 'independence') return;
  try {
    if (localStorage.getItem('theme') !== null) return;
    localStorage.setItem('theme', 'independence'); localStorage.setItem('themeAuto', '1');
  } catch { return; }
  location.reload();   // motyw głęboki: sceny 3D i układ czytają go przy starcie
}

/** Po odpowiedzi /api/me: jeśli zapisany jest motyw, którego gracz nie odblokował, wraca domyślny
 *  (a skoro Aero ma inne domyślne 3D / 2D i własny układ, strona od razu się przeładowuje, żeby sceny zaczęły od zera) */
export function enforceThemes(unlocked: string[]) {
  const t = getTheme();
  if ((t === 'aero' || t === 'independence') && !unlocked.includes(t)) {   // Aero bez karty albo Niepodległość po terminie
    let auto = false;
    try { auto = localStorage.getItem('themeAuto') === '1'; } catch { /* bez zapamiętania */ }
    if (auto) { try { localStorage.removeItem('theme'); localStorage.removeItem('themeAuto'); } catch { /* bez zapamiętania */ } applyTheme('default'); }
    else setTheme('default');
    location.reload();
  }
}
