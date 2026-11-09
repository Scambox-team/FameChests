// @ts-nocheck -- zakładka „Karty” panelu admina: wyszukiwarka wszystkich kart, eksport i import (JSON / CSV)
// Serwer: server/src/routes/cards_io.rs. Funkcje panelu (api, openCardForm, load...) przychodzą z panel.ts.

const FLAGS = [
  ['all', 'Wszystkie'], ['noimg', 'Bez zdjęcia'], ['own', 'Własne'], ['builtin', 'Wbudowane'], ['mod', 'Zmienione'],
  ['hidden', 'Ukryte'], ['excl', 'Ekskluzywne'], ['owned', 'Zdobyte przez graczy'], ['special', 'Specjalne'],
];
const SORTS = [['rarity', 'Najrzadsze najpierw'], ['name', 'Nazwa A–Z'], ['crate', 'Skrzynka'], ['owned', 'Najczęściej posiadane']];
const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const PAGE = 120;
const CHESS = ['szachy', 'szachy_czarne'];   // skrzynki szachów mają własną zakładkę admina

export function createCardsTool({ A, $, $$, esc, api, toast, cardTile, openCardForm, load, hiddenSecret }) {
  const S = { q: '', rarity: 'all', crate: 'all', type: 'all', flag: 'all', sort: 'rarity', limit: PAGE };
  let shown = [];          // wyniki ostatniego wyszukiwania
  let checked = false;     // import sprawdzony (podgląd) i gotowy do zapisu

  const crateName = id => A.cat.crates.find(c => c.id === id)?.name || id;

  // tekst, w którym szuka wyszukiwarka; tajnej karty (bez „Pokaż tajne”) nie da się znaleźć po nazwie
  function haystack(c) {
    const key = A.showSecrets + ':' + c.name;
    if (c._hKey !== key) {
      c._hKey = key;
      const R = A.cat.rarities[c.rarity]?.name || c.rarity;
      c._h = fold(hiddenSecret(c) ? R : [c.name, c.id, c.subtitle, c.attack, c.attack2, c.country, R, A.cat.types[c.type]?.name,
        ...(c.crates || [c.crate]).map(k => `${crateName(k)} ${A.cat.crates.find(x => x.id === k)?.short || ''}`),
        ...(c.abilities || []).map(a => a.name)].join(' '));
    }
    return c._h;
  }

  function matches(c) {
    if (S.rarity !== 'all' && c.rarity !== S.rarity) return false;
    if (S.type !== 'all' && c.type !== S.type) return false;
    if (S.crate !== 'all' && !(c.crates || [c.crate]).includes(S.crate)) return false;
    switch (S.flag) {
      case 'noimg': if (c.hasImage) return false; break;
      case 'own': if (c.builtin) return false; break;
      case 'builtin': if (!c.builtin) return false; break;
      case 'mod': if (!c.modified) return false; break;
      case 'hidden': if (!c.hidden) return false; break;
      case 'excl': if (!(c.exclusive || []).length) return false; break;
      case 'owned': if (!c.owned) return false; break;
      case 'special': if (c.rarity !== 'special') return false; break;
    }
    const h = haystack(c);
    return fold(S.q).split(/\s+/).filter(Boolean).every(t => h.includes(t));
  }

  function fillSelects() {
    if (!A.cat) return;
    const opts = (id, rows, cur) => {
      const el = $(id);
      if (!el) return;
      el.innerHTML = rows.map(([v, n]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');
    };
    opts('#gcRarity', [['all', 'Każda rzadkość'], ...A.cat.rarityOrder.map(r => [r, A.cat.rarities[r].name])], S.rarity);
    opts('#gcCrate', [['all', 'Każda skrzynka'], ...A.cat.crates.filter(c => !c.hidden).map(c => [c.id, c.name])], S.crate);
    opts('#gcType', [['all', 'Każdy typ'], ...Object.entries(A.cat.types).map(([k, t]) => [k, `${t.icon} ${t.name}`])], S.type);
    opts('#gcFlag', FLAGS, S.flag);
    opts('#gcSort', SORTS, S.sort);
    opts('#impCrate', [['', 'Skrzynka dla kart bez kolumny „crates”…'], ...A.cat.crates.filter(c => !c.hidden && !c.special && !CHESS.includes(c.id)).map(c => [c.id, c.name])],
      $('#impCrate')?.value || '');
  }

  function render() {
    if (!A.cat || !$('#gcList')) return;
    fillSelects();
    const order = A.cat.rarityOrder;
    const by = {
      rarity: (a, b) => order.indexOf(b.rarity) - order.indexOf(a.rarity) || a.name.localeCompare(b.name, 'pl'),
      name: (a, b) => a.name.localeCompare(b.name, 'pl'),
      crate: (a, b) => crateName(a.crate).localeCompare(crateName(b.crate), 'pl') || a.name.localeCompare(b.name, 'pl'),
      owned: (a, b) => (b.owned || 0) - (a.owned || 0) || a.name.localeCompare(b.name, 'pl'),
    }[S.sort];
    shown = A.cat.cards.filter(matches).sort((a, b) => a.hidden - b.hidden || by(a, b));
    $('#gcCount').textContent = `${shown.length} z ${A.cat.cards.length}`;
    $('#gcList').innerHTML = shown.slice(0, S.limit).map(c => cardTile(c, '')).join('') || '<div class="empty">Nic nie pasuje do wyszukiwania.</div>';
    const more = $('#gcMore');
    more.hidden = shown.length <= S.limit;
    more.textContent = `Pokaż więcej (jeszcze ${shown.length - S.limit})`;
    const n = exportable().length;   // karty ukryte serwer pomija w eksporcie, więc ich nie liczymy
    for (const b of $$('#gcExport [data-exp]:not([data-scope])')) b.disabled = !n;
    const lab = $('#gcExpLabel');
    if (lab) lab.textContent = `Pobierz wyniki (${n}):`;
  }

  // ---------------------------------------------------------------- eksport

  // wszystkie pasujące karty (nie tylko pierwsza strona), w kolejności wyświetlania
  const exportable = () => shown.filter(c => !c.hidden);

  async function download(body, name) {
    const res = await fetch('/api/admin/cards/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Błąd serwera');
    await save(await res.blob(), name);
  }

  async function save(blob, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------------------------------------------------------------- import

  function format() {
    const f = $('#impFormat').value;
    if (f !== 'auto') return f;
    return /^\s*[[{]/.test($('#impText').value) ? 'json' : 'csv';
  }

  function importBody(dryRun) {
    return {
      format: format(), text: $('#impText').value, dryRun, defaultCrate: $('#impCrate').value || null,
      updateExisting: $('#impUpdate').checked, skipExisting: $('#impSkip').checked, fetchImages: $('#impImages').checked,
      partial: $('#impPartial').checked,
    };
  }

  const ACTIONS = { create: ['nowa', 'own'], update: ['zmiana', 'mod'], skip: ['pominięta', ''], error: ['błąd', 'warn'] };

  function renderReport(r) {
    const head = r.applied ? 'Zaimportowano' : r.dryRun ? 'Podgląd (nic nie zapisano)' : 'Nic nie zapisano';
    const sums = [`${r.created} nowych`, `${r.updated} zmienionych`, `${r.skipped} pominiętych`, `${r.failed} z błędem`].join(' · ');
    $('#impReport').innerHTML = `<p><b>${head}:</b> ${sums}</p>` +
      (r.warnings?.length ? `<ul class="a-imp-warn">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '') +
      `<div class="a-imp-rows">${r.rows.map(x => `<div class="a-imp-row-r ${x.action}"><span>${x.row}</span><b>${esc(x.name || '—')}</b>
        <span class="a-badges"><i class="${ACTIONS[x.action][1]}">${ACTIONS[x.action][0]}</i></span>
        <small>${esc(x.message || (x.id ? x.id : ''))}</small></div>`).join('')}</div>`;
  }

  async function runImport(dryRun) {
    if (!$('#impText').value.trim()) return toast('Wybierz plik albo wklej jego zawartość', true);
    const btns = [$('#impCheck'), $('#impRun')];
    btns.forEach(b => { b.disabled = true; });
    $('#impRun').textContent = dryRun ? 'Importuj' : 'Importuję… (zdjęcia z Wikipedii mogą potrwać)';
    try {
      const r = await api('/api/admin/cards/import', { method: 'POST', json: importBody(dryRun) });
      renderReport(r);
      if (dryRun) {
        checked = r.created + r.updated > 0 && (r.failed === 0 || $('#impPartial').checked);
        if (r.failed && !$('#impPartial').checked) toast('Popraw błędy w pliku albo zaznacz import poprawnych wierszy', true);
      } else if (r.applied) {
        checked = false;
        toast(`Zaimportowano karty: ${r.created} nowych, ${r.updated} zmienionych`);
        await load();
      }
    } catch (err) { toast(err.message, true); checked = false; }
    $('#impRun').textContent = 'Importuj';
    $('#impCheck').disabled = false;
    $('#impRun').disabled = !checked;
  }

  function invalidate() {
    checked = false;
    if ($('#impRun')) $('#impRun').disabled = true;
  }

  function bind() {
    if (!$('#gcList')) return;
    const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
    on('#gcSearch', 'input', e => { S.q = e.target.value; S.limit = PAGE; render(); });
    for (const [id, key] of [['#gcRarity', 'rarity'], ['#gcCrate', 'crate'], ['#gcType', 'type'], ['#gcFlag', 'flag'], ['#gcSort', 'sort']]) {
      on(id, 'change', e => { S[key] = e.target.value; S.limit = PAGE; render(); });
    }
    on('#gcMore', 'click', () => { S.limit += PAGE * 2; render(); });
    on('#gcList', 'click', e => { const b = e.target.closest('[data-card]'); if (b) openCardForm(b.dataset.card); });
    on('#gcNew', 'click', () => openCardForm(null, S.crate !== 'all' ? S.crate : A.cat.crates.find(c => !c.hidden && !c.special && !CHESS.includes(c.id))?.id));
    on('#gcExport', 'click', async e => {
      const b = e.target.closest('[data-exp]'); if (!b) return;
      const all = b.dataset.scope === 'all', ext = b.dataset.exp, ids = all ? [] : exportable().map(c => c.id);
      if (!all && !ids.length) return toast('Brak kart do pobrania', true);
      try {
        await download({ format: ext, ids }, all ? `scambox-karty-wszystkie.${ext}` : `scambox-karty-wyniki-${ids.length}.${ext}`);
        toast(all ? 'Pobrano wszystkie karty' : `Pobrano karty z wyszukiwania (${ids.length})`);
      } catch (err) { toast(err.message, true); }
    });

    on('#impFile', 'change', async e => {
      const f = e.target.files[0]; if (!f) return;
      $('#impText').value = await f.text();
      $('#impFormat').value = /\.csv$/i.test(f.name) ? 'csv' : /\.json$/i.test(f.name) ? 'json' : 'auto';
      invalidate();
      $('#impReport').innerHTML = '';
    });
    for (const id of ['#impText', '#impFormat', '#impCrate', '#impUpdate', '#impSkip', '#impImages', '#impPartial']) on(id, 'input', invalidate);
    on('#impCheck', 'click', () => runImport(true));
    on('#impRun', 'click', () => {
      if (checked && confirm('Zapisać karty z pliku? Karty o tym samym id zostaną zaktualizowane.')) runImport(false);
    });
    on('#impTemplate', 'click', async e => {
      const b = e.target.closest('[data-tpl]'); if (!b) return;
      const res = await fetch(`/api/admin/cards/template?format=${b.dataset.tpl}`);
      if (res.ok) await save(await res.blob(), `scambox-karty-wzor.${b.dataset.tpl}`);
    });
  }

  return { render, bind };
}
