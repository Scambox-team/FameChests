// Panel admina podzielony na działy (jedna długa strona była nieczytelna). Elementy mają `data-sec`, pokazuje się jeden dział.
// Zakładka Szachy (/admin/chess) zostaje bez podziału.

const SECTIONS: [string, string][] = [
  ['crates', 'Skrzynki'], ['cards', 'Karty'], ['players', 'Gracze i dziennik'], ['content', 'Treści i wydarzenia'], ['games', 'Gry i kasyno'],
];
const KEY = 'adminSection';

export function initSections() {
  if (document.body.classList.contains('a-chess')) return;
  const main = document.querySelector<HTMLElement>('main.admin');
  if (!main) return;
  const nav = document.createElement('nav');
  nav.className = 'a-secnav';
  nav.setAttribute('aria-label', 'Działy panelu');
  nav.innerHTML = SECTIONS.map(([id, label]) => `<button type="button" data-sec-go="${id}">${label}</button>`).join('');
  main.before(nav);

  const show = (id: string) => {
    if (!SECTIONS.some(([s]) => s === id)) id = 'crates';
    main.classList.toggle('a-single', id !== 'crates');
    document.querySelectorAll<HTMLElement>('[data-sec]').forEach(el => el.classList.toggle('a-sec-off', el.dataset.sec !== id));
    nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.secGo === id)));
    try { localStorage.setItem(KEY, id); } catch { /* bez pamięci przeglądarki */ }
    if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
  };
  nav.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sec-go]');
    if (b) show(b.dataset.secGo!);
  });
  let start = location.hash.slice(1);
  if (!start) { try { start = localStorage.getItem(KEY) || ''; } catch { /* brak */ } }
  show(start);
}
