// Motyw wyglądu: `localStorage.theme` = `y2k` albo `aero` ustawia `data-theme` na <html>.
// Wywoływane jak najwcześniej (main.tsx i skrypt w index.html), żeby strona nie migała domyślnym motywem.
// Frutiger Aero jest zablokowany, dopóki serwer nie poda go w `themes` z /api/me (gracz wylosował kartę aero).

export type Theme = 'default' | 'y2k' | 'aero';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'y2k' || t === 'aero' ? t : 'default';
  } catch { return 'default'; }
}

export function applyTheme(t: Theme = getTheme()) {
  if (t === 'default') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function setTheme(t: Theme) {
  try { if (t === 'default') localStorage.removeItem('theme'); else localStorage.setItem('theme', t); } catch { /* bez zapamiętania */ }
  applyTheme(t);
}

/** Po odpowiedzi /api/me: jeśli zapisany jest motyw, którego gracz nie odblokował, wraca domyślny */
export function enforceThemes(unlocked: string[]) {
  if (getTheme() === 'aero' && !unlocked.includes('aero')) setTheme('default');
}
