// Motyw wyglądu (eksperymentalny): `localStorage.theme` = `y2k` ustawia `data-theme="y2k"` na <html>.
// Wywoływane jak najwcześniej (main.tsx i skrypt w index.html), żeby strona nie migała domyślnym motywem.

export type Theme = 'default' | 'y2k';

export function getTheme(): Theme {
  try { return localStorage.getItem('theme') === 'y2k' ? 'y2k' : 'default'; } catch { return 'default'; }
}

export function applyTheme(t: Theme = getTheme()) {
  if (t === 'y2k') document.documentElement.dataset.theme = 'y2k';
  else delete document.documentElement.dataset.theme;
}

export function setTheme(t: Theme) {
  try { if (t === 'y2k') localStorage.setItem('theme', 'y2k'); else localStorage.removeItem('theme'); } catch { /* bez zapamiętania */ }
  applyTheme(t);
}
