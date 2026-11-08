// Wspólna wyszukiwarka długich list panelu admina (lupa, licznik „X z Y”, czyszczenie, Esc). Działa na DOM, więc obsługuje i stary HTML,
// i listy z Reacta: `attachSearch` dokłada pasek nad listą i chowa niepasujące pozycje; `watchLists` dopina go do list z LISTS po każdym renderze.
// Dopasowanie: bez wielkości liter i polskich znaków (NFD + usunięcie diakrytyków, ł -> l).
const SEARCH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const MIN_ITEMS = 6;   // krótsze listy nie dostają paska

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();

// tekst pozycji bez przycisków i pól (żeby „Karty” z przycisku nie pasowało do każdego gracza)
const plainText = (el: Element) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('button, select, input, textarea, style, script, svg').forEach(n => n.remove());
  return c.textContent ?? '';
};

type Opts = { placeholder?: string; getText?: (el: HTMLElement) => string; inside?: boolean; key?: string };
const saved = new Map<string, string>();   // wpisane hasło przeżywa przerysowanie listy

export function attachSearch(container: HTMLElement, itemsSelector: string, opts: Opts = {}) {
  if (container.dataset.ls) return;
  container.dataset.ls = '1';
  const key = opts.key ?? itemsSelector;
  const bar = document.createElement('div');
  bar.className = 'ls-bar';
  bar.innerHTML = `<label class="ls-field">${SEARCH_SVG}<input type="text" class="ls-input" autocomplete="off" spellcheck="false" aria-label="${opts.placeholder ?? 'Szukaj na liście'}" placeholder="${opts.placeholder ?? 'Szukaj na liście…'}"><button type="button" class="ls-clear" aria-label="Wyczyść wyszukiwanie" hidden>${X_SVG}</button></label><span class="ls-count" aria-live="polite"></span><p class="ls-none muted small" hidden>Nic nie pasuje do wyszukiwania.</p>`;
  if (opts.inside) container.prepend(bar); else container.before(bar);
  const input = bar.querySelector<HTMLInputElement>('.ls-input')!, clear = bar.querySelector<HTMLButtonElement>('.ls-clear')!;
  const count = bar.querySelector<HTMLElement>('.ls-count')!, none = bar.querySelector<HTMLElement>('.ls-none')!;
  const getText = opts.getText ?? plainText;
  input.value = saved.get(key) ?? '';

  let busy = false;
  const apply = () => {
    busy = false;
    const q = norm(input.value.trim());
    const items = Array.from(container.querySelectorAll<HTMLElement>(itemsSelector));
    let shown = 0;
    for (const el of items) {
      const ok = !q || norm(getText(el)).includes(q);
      el.classList.toggle('ls-off', !ok);
      if (ok) shown++;
    }
    clear.hidden = !input.value;
    count.textContent = items.length ? `${shown} z ${items.length}` : '';
    none.hidden = !(q && items.length && !shown);
    bar.hidden = items.length < MIN_ITEMS && !q;
  };
  const later = () => { if (!busy) { busy = true; requestAnimationFrame(apply); } };
  input.addEventListener('input', () => { saved.set(key, input.value); apply(); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; saved.delete(key); apply(); } });
  clear.addEventListener('click', () => { input.value = ''; saved.delete(key); apply(); input.focus(); });
  new MutationObserver(later).observe(container, { childList: true, subtree: true });
  apply();
}

type ListCfg = { container?: string; items: string; placeholder: string; inside?: boolean };
const LISTS: ListCfg[] = [
  { container: '#crateList', items: '.a-crate', placeholder: 'Szukaj skrzynki (nazwa, id)…' },
  { container: '#userList', items: '.a-user:not(.head)', placeholder: 'Szukaj gracza (nick, id, email)…' },
  { container: '#achList', items: '.ach-row', placeholder: 'Szukaj osiągnięcia…' },
  { container: '#msgList', items: '.a-link', placeholder: 'Szukaj wiadomości…' },
  { container: '#linkList', items: '.a-link', placeholder: 'Szukaj linku (nazwa, kod)…' },
  { container: '#skinRows', items: '.a-skin', placeholder: 'Szukaj skina…' },
  { container: '.vr-list', items: '.vr-item', placeholder: 'Szukaj wariantu…', inside: true },
  { container: '.stk-lib', items: '.stk-libitem', placeholder: 'Szukaj naklejki…' },
  { items: 'article', placeholder: 'Szukaj na liście…' },                 // Zgłoszenia, Eventy (React)
  { items: 'tbody tr', placeholder: 'Szukaj w tabeli…' },                 // Polecenia (React)
];

export function watchLists(root: HTMLElement): () => void {
  let queued = false;
  const run = () => {
    queued = false;
    for (const c of LISTS) {
      if (c.container) {
        root.querySelectorAll<HTMLElement>(c.container).forEach(el => attachSearch(el, c.items, { placeholder: c.placeholder, inside: c.inside, key: c.container }));
      } else {
        const first = root.querySelector<HTMLElement>(c.items);
        let host = first?.parentElement ?? null;
        if (host && host.tagName === 'TBODY') host = host.closest('table');
        if (host && host.parentElement) {
          if (host.tagName === 'TABLE') attachSearch(host, c.items, { placeholder: c.placeholder, key: c.items });
          else if (!host.dataset.ls && !host.closest('.panel') ) attachSearch(host, c.items, { placeholder: c.placeholder, key: c.items, inside: true });
        }
      }
    }
  };
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  mo.observe(root, { childList: true, subtree: true });
  run();
  return () => mo.disconnect();
}
