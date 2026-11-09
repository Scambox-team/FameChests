// Motyw wyglądu: `localStorage.theme` = `y2k`, `aero`, `warm` albo `vapor` ustawia `data-theme` na <html>.
// Wywoływane jak najwcześniej (main.tsx i skrypt w index.html), żeby strona nie migała domyślnym motywem.
// Frutiger Aero jest zablokowany, dopóki serwer nie poda go w `themes` z /api/me (gracz wylosował kartę aero).

export type Theme = 'default' | 'y2k' | 'aero' | 'warm' | 'vapor';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'y2k' || t === 'aero' || t === 'warm' || t === 'vapor' ? t : 'default';
  } catch { return 'default'; }
}

/** Motyw Warm Editorial pisze nagłówki szeryfem Newsreader: krój wczytujemy dopiero przy tym motywie (inni gracze nie płacą za niego ruchem) */
function warmFont() {
  if (document.getElementById('warmFont')) return;
  const l = document.createElement('link');
  l.id = 'warmFont'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,500;0,6..72,600;1,6..72,500;1,6..72,600&display=swap';
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
  if (t === 'default') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  if (t === 'warm') warmFont();
  if (t === 'vapor') vaporFont();
}

/** Motywy, które zmieniają też sceny 3D i układ: przejście do nich albo z nich przeładowuje stronę (sceny czytają motyw raz) */
export const isDeepTheme = (t: Theme) => t === 'warm' || t === 'aero' || t === 'vapor';
/** Z głębokich motywów tylko Warm i Aero mają domyślnie wyłączone 3D (własne ilustracje 2D); Vaporwave ma neonowe 3D */
export const defaultsTo2D = (t: Theme) => t === 'warm' || t === 'aero';

export function setTheme(t: Theme) {
  try { if (t === 'default') localStorage.removeItem('theme'); else localStorage.setItem('theme', t); } catch { /* bez zapamiętania */ }
  applyTheme(t);
}

/** Po odpowiedzi /api/me: jeśli zapisany jest motyw, którego gracz nie odblokował, wraca domyślny
 *  (a skoro Aero ma inne domyślne 3D / 2D i własny układ, strona od razu się przeładowuje, żeby sceny zaczęły od zera) */
export function enforceThemes(unlocked: string[]) {
  if (getTheme() === 'aero' && !unlocked.includes('aero')) { setTheme('default'); location.reload(); }
}
