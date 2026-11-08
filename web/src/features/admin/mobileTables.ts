// Telefon: tabele rysują się jako karty (wiersz = blok, komórka = etykieta + wartość). Etykiety bierzemy z nagłówków kolumn,
// także w tabelach generowanych w starym kodzie - obserwator dopisuje `data-label` po każdym renderze.
function label(table: HTMLTableElement) {
  const heads = Array.from(table.querySelectorAll<HTMLElement>('thead th, thead td'));
  let names = heads.map(h => (h.textContent ?? '').trim());
  if (!names.length) {
    const first = table.querySelector('tr');
    if (first && first.querySelector('th') && !first.querySelector('td')) names = Array.from(first.children).map(c => (c.textContent ?? '').trim());
  }
  table.querySelectorAll<HTMLTableRowElement>('tr').forEach(tr => {
    let col = 0;
    Array.from(tr.children).forEach(c => {
      if (c.tagName === 'TD' && !c.hasAttribute('data-label')) {
        const n = names[col];
        if (n) c.setAttribute('data-label', n);
      }
      col += (c as HTMLTableCellElement).colSpan || 1;
    });
  });
}

export function watchTables(root: HTMLElement): () => void {
  let queued = false;
  const run = () => { queued = false; root.querySelectorAll<HTMLTableElement>('table').forEach(label); };
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  mo.observe(root, { childList: true, subtree: true });
  run();
  return () => mo.disconnect();
}
