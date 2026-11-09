// Motyw wyglądu: `localStorage.theme` = `y2k`, `aero` albo `warm` ustawia `data-theme` na <html>.
// Wywoływane jak najwcześniej (main.tsx i skrypt w index.html), żeby strona nie migała domyślnym motywem.
// Frutiger Aero jest zablokowany, dopóki serwer nie poda go w `themes` z /api/me (gracz wylosował kartę aero).

export type Theme = 'default' | 'y2k' | 'aero' | 'warm';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'y2k' || t === 'aero' || t === 'warm' ? t : 'default';
  } catch { return 'default'; }
}

/** Motyw Warm Editorial pisze nagłówki szeryfem Newsreader: krój wczytujemy dopiero przy tym motywie (inni gracze nie płacą za niego ruchem) */
function warmFont() {
  if (document.getElementById('warmFont')) return;
  const l = document.createElement('link');
  l.id = 'warmFont'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap';
  document.head.appendChild(l);
}

export function applyTheme(t: Theme = getTheme()) {
  if (t === 'default') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  if (t === 'warm') warmFont();
}

export function setTheme(t: Theme) {
  try { if (t === 'default') localStorage.removeItem('theme'); else localStorage.setItem('theme', t); } catch { /* bez zapamiętania */ }
  applyTheme(t);
}

/** Po odpowiedzi /api/me: jeśli zapisany jest motyw, którego gracz nie odblokował, wraca domyślny */
export function enforceThemes(unlocked: string[]) {
  if (getTheme() === 'aero' && !unlocked.includes('aero')) setTheme('default');
}
