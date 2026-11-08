// Panel admina (panel.html): jedna pozycja menu = elementy z `data-sec="<id>"`. Menu rysuje AdminApp (adminMenu.ts).
// Zakładka Szachy (/admin/chess) zostaje bez podziału.
import { PANEL_IDS } from './adminMenu';

export function showSection(id: string) {
  if (document.body.classList.contains('a-chess')) return;
  if (!PANEL_IDS.includes(id)) id = 'skrzynki';
  document.querySelector<HTMLElement>('main.admin')?.classList.toggle('a-single', id !== 'skrzynki');
  document.querySelectorAll<HTMLElement>('[data-sec]').forEach(el => el.classList.toggle('a-sec-off', !(el.dataset.sec ?? '').split(' ').includes(id)));
}
