// Podgląd naklejki jak podgląd karty (`openViewer` w fx/effects.ts): ta sama nakładka `.viewer`, ten sam przechył za kursorem (`tiltMove`, 14 stopni)
// i efekty wariantów naklejki; widać samą naklejkę, bez karty i tła pod nią (zwykła / foliowana / holo / złota - filtry z stickers.css na jednym PNG).
// Wywołujemy go kliknięciem naklejki w ekwipunku, w wyniku otwarcia skrzynki, w sklepie i w oknie wyboru nagrody za level.
import { S } from '../../game/store';
import { Sound } from '../../sound/sound';
import { tiltLeave, tiltMove } from '../../cards/tilt';
import { esc } from '../../lib/format';
import { openStickerEditor, stickerTileHTML, VARIANT_NAME } from './stickers';

export interface StickerView {
  sticker: string;
  variant: string;
  name: string;
  rarity: string;
  /** wersja obrazka (adres `?v=`) */
  v?: number;
  /** numer naklejki w moim ekwipunku: pokazuje przycisk „Naklej na kartę” */
  item?: number | null;
}

const VARIANT_INFO: Record<string, string> = {
  normal: 'Zwykła naklejka, bez efektu.',
  foil: 'Foliowana: biały połysk przesuwa się po kształcie naklejki.',
  holo: 'Holo: po naklejce przelewa się tęcza.',
  gold: 'Złota: złoty odcień, poświata i błysk.',
};
const ORDER = ['normal', 'foil', 'holo', 'gold'];

export function closeStickerViewer() {
  document.querySelector('.viewer.stkv-viewer')?.remove();
}

export function openStickerViewer(d: StickerView) {
  closeStickerViewer();
  const rc = S.cfg.rarities?.[d.rarity];
  const el = document.createElement('div');
  el.className = 'viewer stkv-viewer';
  el.setAttribute('role', 'dialog');
  const draw = (variant: string) => {
    el.innerHTML = `
      <div class="viewer-stage stkv-stage">
        <div class="stkv-slab" style="--rc:${rc?.color ?? '#9aa3ad'}">
          <span class="stkv-art">${stickerTileHTML(d.sticker, variant, d.v)}</span>
        </div>
      </div>
      <div class="viewer-info" style="--rc:${rc?.color ?? 'var(--hue)'}">
        <div class="vi-rarity">${esc(rc?.name ?? d.rarity)}${variant !== 'normal' ? ` · <span class="holo-txt">${esc(VARIANT_NAME[variant] ?? variant)}</span>` : ''}</div>
        <h2>${esc(d.name)}</h2>
        <div class="muted">Naklejka na karty</div>
        <p class="vi-desc">${esc(VARIANT_INFO[variant] ?? '')}</p>
        <p class="muted small">Możesz ją nakleić na każdą swoją kartę (na zdjęcie albo na całą kartę).</p>
        <div class="vi-vlabel">Wariant naklejki <span class="muted">(podgląd)</span></div>
        <div class="stkv-variants">${ORDER.map(v => `<button type="button" class="btn${v === variant ? ' primary' : ''}" data-v="${v}" aria-pressed="${v === variant}">${esc(VARIANT_NAME[v])}</button>`).join('')}</div>
        <div class="vi-actions">
          ${d.item ? '<button class="btn primary" data-act="place">Naklej na kartę</button>' : ''}
          <button class="btn" data-act="close">Zamknij</button>
        </div>
        <div class="muted small">Porusz kursorem nad naklejką, aby ją przechylić.</div>
      </div>`;
  };
  let variant = d.variant || 'normal';
  draw(variant);
  document.body.appendChild(el);
  Sound.whoosh();
  const slab = () => el.querySelector<HTMLElement>('.stkv-slab');
  // delegacja zdarzeń: po zmianie wariantu zawartość jest rysowana od nowa
  el.addEventListener('pointermove', e => { if ((e.target as Element).closest('.stkv-stage')) tiltMove(slab(), e, 14); });
  el.addEventListener('pointerout', e => { if ((e.target as Element).closest('.stkv-stage') && !(e.relatedTarget as Element | null)?.closest?.('.stkv-stage')) tiltLeave(slab()); });
  el.addEventListener('click', e => {
    const t = e.target as Element;
    const v = t.closest<HTMLElement>('[data-v]')?.dataset.v;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (v) { variant = v; draw(variant); Sound.click(); return; }
    if (act === 'place') { closeStickerViewer(); openStickerEditor(null, d.item); return; }
    if (act === 'close' || t === el) closeStickerViewer();
  });
  const key = (e: KeyboardEvent) => {
    if (!el.isConnected) return window.removeEventListener('keydown', key);
    if (e.key === 'Escape') { e.stopPropagation(); closeStickerViewer(); window.removeEventListener('keydown', key); }
  };
  window.addEventListener('keydown', key, true);
}
