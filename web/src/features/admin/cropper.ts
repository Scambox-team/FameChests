// Okno kadrowania zdjęcia (czysty DOM, bez bibliotek). Obrazek ładuje zwykły <img src> (dla linków nie czytamy pikseli
// w przeglądarce - CORS), a wynik to ułamki kadru {x, y, w, h} (0..1) względem oryginału; kadruje serwer.

export interface CropRect { x: number; y: number; w: number; h: number }
/** null = zamknięto okno bez wyboru; { crop: null } = „bez kadrowania” */
export type CropChoice = { crop: CropRect | null } | null;

interface Preset { label: string; ratio: number | null }
// 1 / .96 to proporcje .card-photo na karcie (cards/css/base.css); .8 - karta z dwiema zdolnościami
const PRESETS: Preset[] = [
  { label: 'Zdjęcie na karcie (1 : 0,96)', ratio: 1 / 0.96 },
  { label: 'Kwadrat (1 : 1)', ratio: 1 },
  { label: 'Szersze (1 : 0,8)', ratio: 1 / 0.8 },
  { label: 'Dowolny kadr', ratio: null },
];
const MIN_PX = 32;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function openCropper(src: string, title = 'Kadrowanie zdjęcia'): Promise<CropChoice> {
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.className = 'crp-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `<div class="crp-dialog">
      <h3 class="crp-title"></h3>
      <p class="crp-msg muted small">Wczytuję zdjęcie…</p>
      <div class="crp-body" hidden>
        <div class="crp-stage"><img class="crp-img" alt="" draggable="false" referrerpolicy="no-referrer">
          <div class="crp-box"><div class="crp-grid"></div>${HANDLES.map(h => `<i class="crp-h crp-h-${h}" data-h="${h}"></i>`).join('')}</div></div>
        <div class="crp-side">
          <label>Proporcje<select class="crp-ratio">${PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('')}</select></label>
          <label>Powiększenie<input class="crp-zoom" type="range" min="1" max="8" step="0.01" value="1"></label>
          <div class="crp-prev"><img alt="" draggable="false" referrerpolicy="no-referrer"></div>
          <small class="muted crp-info"></small>
        </div>
      </div>
      <div class="crp-actions">
        <button type="button" class="btn primary" data-a="ok" disabled>Zastosuj kadr</button>
        <button type="button" class="btn" data-a="none" disabled>Bez kadrowania</button>
        <button type="button" class="btn" data-a="cancel">Anuluj</button>
      </div></div>`;
    (root.querySelector('.crp-title') as HTMLElement).textContent = title;
    const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    const img = $<HTMLImageElement>('.crp-img'), stage = $('.crp-stage'), box = $('.crp-box');
    const prev = $('.crp-prev'), prevImg = $<HTMLImageElement>('.crp-prev img');
    const ratioSel = $<HTMLSelectElement>('.crp-ratio'), zoom = $<HTMLInputElement>('.crp-zoom'), info = $('.crp-info');

    let natW = 1, natH = 1, dw = 1, dh = 1; // oryginał i widoczny rozmiar obrazka w px
    let ratio: number | null = PRESETS[0].ratio; // szerokość / wysokość kadru w pikselach
    let r: CropRect = { x: 0, y: 0, w: 1, h: 1 }; // ułamki oryginału

    const prevKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    function done(v: CropChoice) {
      document.removeEventListener('keydown', prevKey, true);
      removeEventListener('resize', layout);
      root.remove();
      resolve(v);
    }

    // największy kadr o danych proporcjach mieści się w obrazku
    function maxSize(): { w: number; h: number } {
      if (ratio == null) return { w: 1, h: 1 };
      const a = ratio * natH / natW; // w / h w ułamkach
      return a >= 1 ? { w: 1, h: 1 / a } : { w: a, h: 1 };
    }
    const minFrac = () => ({ w: Math.min(1, MIN_PX / natW), h: Math.min(1, MIN_PX / natH) });

    function fit(next: CropRect) {
      const m = minFrac();
      let { x, y, w, h } = next;
      w = clamp(w, m.w, 1); h = clamp(h, m.h, 1);
      x = clamp(x, 0, 1 - w); y = clamp(y, 0, 1 - h);
      r = { x, y, w, h };
      render();
    }

    function setRatio(newRatio: number | null) {
      ratio = newRatio;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const m = maxSize();
      // zachowaj mniej więcej obecny rozmiar (zoom), dopasuj do nowych proporcji
      const z = clamp(zoom.valueAsNumber || 1, 1, 8);
      const w = m.w / z, h = ratio == null ? m.h / z : w * natW / (ratio * natH);
      fit({ x: cx - w / 2, y: cy - h / 2, w, h });
    }

    function render() {
      box.style.left = `${r.x * dw}px`; box.style.top = `${r.y * dh}px`;
      box.style.width = `${r.w * dw}px`; box.style.height = `${r.h * dh}px`;
      const m = maxSize();
      zoom.value = String(clamp(m.w / r.w, 1, 8));
      // podgląd wyniku: ten sam obrazek przesunięty i powiększony w ramce o proporcjach kadru
      const pw = 160, ph = Math.min(200, pw * (r.h * natH) / (r.w * natW));
      prev.style.width = `${pw}px`; prev.style.height = `${ph}px`;
      prevImg.style.width = `${pw / r.w}px`; prevImg.style.height = `${ph / r.h}px`;
      prevImg.style.left = `${-r.x / r.w * pw}px`; prevImg.style.top = `${-r.y / r.h * ph}px`;
      info.textContent = `Kadr: ${Math.round(r.w * natW)} × ${Math.round(r.h * natH)} px z ${natW} × ${natH} px`;
    }

    function layout() {
      const maxW = Math.min(560, innerWidth - 56), maxH = Math.max(160, innerHeight * 0.55);
      const s = Math.min(maxW / natW, maxH / natH, 1);
      dw = Math.max(40, Math.round(natW * s)); dh = Math.max(40, Math.round(natH * s));
      stage.style.width = `${dw}px`; stage.style.height = `${dh}px`;
      render();
    }

    // ---- przeciąganie i zmiana rozmiaru (mysz i dotyk)
    type Drag = { mode: string; sx: number; sy: number; start: CropRect };
    let drag: Drag | null = null;
    box.addEventListener('pointerdown', e => {
      const mode = (e.target as HTMLElement).dataset.h || 'move';
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      drag = { mode, sx: e.clientX, sy: e.clientY, start: { ...r } };
    });
    box.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = (e.clientX - drag.sx) / dw, dy = (e.clientY - drag.sy) / dh, s = drag.start;
      if (drag.mode === 'move') return fit({ ...s, x: s.x + dx, y: s.y + dy });
      resize(drag.mode, s, dx, dy);
    });
    const end = (e: PointerEvent) => { if (drag) { drag = null; try { box.releasePointerCapture(e.pointerId); } catch { /* już zwolniony */ } } };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);

    function resize(h: string, s: CropRect, dx: number, dy: number) {
      let l = s.x, t = s.y, rt = s.x + s.w, b = s.y + s.h;
      if (h.includes('w')) l = clamp(l + dx, 0, rt - minFrac().w);
      if (h.includes('e')) rt = clamp(rt + dx, l + minFrac().w, 1);
      if (h.includes('n')) t = clamp(t + dy, 0, b - minFrac().h);
      if (h.includes('s')) b = clamp(b + dy, t + minFrac().h, 1);
      if (ratio != null) {
        const a = ratio * natH / natW; // w / h w ułamkach
        const hasX = h.length === 2 || 'we'.includes(h), hasY = h.length === 2 || 'ns'.includes(h);
        // kotwica: przeciwległy narożnik albo środek przeciwległej krawędzi
        const ax = h.includes('w') ? s.x + s.w : h.includes('e') ? s.x : s.x + s.w / 2;
        const ay = h.includes('n') ? s.y + s.h : h.includes('s') ? s.y : s.y + s.h / 2;
        let w = rt - l, hh = b - t;
        if (hasX && hasY) { if (w / a > hh) hh = w / a; else w = hh * a; }
        else if (hasX) hh = w / a;
        else w = hh * a;
        // ile miejsca jest od kotwicy w stronę przeciągania
        const roomX = h.includes('w') ? ax : h.includes('e') ? 1 - ax : 2 * Math.min(ax, 1 - ax);
        const roomY = h.includes('n') ? ay : h.includes('s') ? 1 - ay : 2 * Math.min(ay, 1 - ay);
        const k = Math.min(1, roomX / w, roomY / hh);
        w *= k; hh *= k;
        const m = minFrac();
        if (w < m.w || hh < m.h) { const up = Math.max(m.w / w, m.h / hh); w *= up; hh *= up; }
        l = h.includes('w') ? ax - w : h.includes('e') ? ax : ax - w / 2;
        t = h.includes('n') ? ay - hh : h.includes('s') ? ay : ay - hh / 2;
        rt = l + w; b = t + hh;
      }
      fit({ x: l, y: t, w: rt - l, h: b - t });
    }

    // ---- zoom: suwak i kółko myszy (środek kadru stoi w miejscu)
    function setZoom(z: number) {
      const m = maxSize(), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const w = m.w / clamp(z, 1, 8), h = m.h / clamp(z, 1, 8);
      fit({ x: cx - w / 2, y: cy - h / 2, w, h });
    }
    zoom.addEventListener('input', () => setZoom(zoom.valueAsNumber));
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      setZoom((zoom.valueAsNumber || 1) * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    ratioSel.addEventListener('change', () => setRatio(PRESETS[+ratioSel.value].ratio));

    // ---- przyciski
    root.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'cancel' || e.target === root) done(null);
      else if (a === 'none') done({ crop: null });
      else if (a === 'ok') {
        const full = r.w > 0.999 && r.h > 0.999;
        done({ crop: full ? null : { x: +r.x.toFixed(5), y: +r.y.toFixed(5), w: +r.w.toFixed(5), h: +r.h.toFixed(5) } });
      }
    });
    document.addEventListener('keydown', prevKey, true);
    addEventListener('resize', layout);

    img.onload = () => {
      natW = img.naturalWidth || 1; natH = img.naturalHeight || 1;
      $('.crp-msg').hidden = true; $('.crp-body').hidden = false;
      root.querySelectorAll<HTMLButtonElement>('[data-a=ok],[data-a=none]').forEach(b => { b.disabled = false; });
      prevImg.src = src;
      layout();
      setRatio(ratio);
    };
    img.onerror = () => {
      $('.crp-msg').textContent = 'Nie udało się wczytać zdjęcia. Sprawdź, czy to bezpośredni adres obrazka. Możesz zapisać bez kadrowania, a serwer spróbuje pobrać je sam.';
      root.querySelector<HTMLButtonElement>('[data-a=none]')!.disabled = false;
    };
    img.src = src;
    document.body.appendChild(root);
  });
}
