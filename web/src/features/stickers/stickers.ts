// Naklejki dla graczy (server/src/stickers.rs): kolekcjonerskie naklejki, które nakleja się na karty. To NIE są „naklejki wariantów” z panelu
// admina (`stickersHTML` w cardHtml.ts, strona /stickers) - tamte są po prostu wyglądem wariantu karty.
// Wersje foliowana / holo / złota to filtry CSS (stickers.css) na jednym obrazku PNG.
import { api } from '../../api/client';
import { S, touch } from '../../game/store';
import { esc } from '../../lib/format';
import './stickers.css';

export interface StkPlacement { id: number; item: number; sticker: string; variant: string; x: number; y: number; w: number; rot: number; flip: boolean; photo: boolean }
export interface StkItem { id: number; sticker: string; variant: string }
export interface StkInfo { name: string; rarity: string; v: number }
export interface StkData {
  catalog: Record<string, StkInfo>;
  items: StkItem[];
  placed: Record<string, StkPlacement[]>;
  max: number;
  variants: { key: string; name: string }[];
}

export const VARIANT_NAME: Record<string, string> = { normal: 'Zwykła', foil: 'Foliowana', holo: 'Holo', gold: 'Złota' };

export const stickerUrl = (id: string, v: number | string = 0) => `/gsticker/${encodeURIComponent(id)}?v=${v}`;
const info = (id: string) => (S.stk as StkData | null)?.catalog[id];

/** Pobiera naklejki gracza (katalog, ekwipunek, naklejone na karty) do S.stk */
export async function loadStickers() {
  try { S.stk = await api<StkData>('/api/stickers'); } catch { /* naklejki to dodatek: bez nich gra działa */ }
  touch();
}

/** Jedna naklejka naklejona na karcie (pozycja w % kontenera: karty albo zdjęcia) */
export function stickerHTML(p: Pick<StkPlacement, 'sticker' | 'variant' | 'x' | 'y' | 'w' | 'rot' | 'flip'> & { id?: number }, extra = '') {
  const url = stickerUrl(p.sticker, info(p.sticker)?.v ?? 0);
  return `<i class="gst gst-${esc(p.variant)}${extra}"${p.id != null ? ` data-pid="${p.id}"` : ''} style="--x:${p.x}%;--y:${p.y}%;--w:${p.w}%;--r:${p.rot}deg;--f:${p.flip ? -1 : 1};--img:url('${url}')">` +
    `<img src="${url}" alt="" draggable="false"><b class="gst-fx"></b></i>`;
}

/** Kafelek naklejki do ekwipunku, wyniku otwarcia i wyboru: ten sam wygląd co na karcie, w układzie statycznym */
export function stickerTileHTML(sticker: string, variant: string, v?: number) {
  const url = stickerUrl(sticker, v ?? info(sticker)?.v ?? 0);
  return `<i class="gst gst-tile gst-${esc(variant)}" style="--img:url('${url}')"><img src="${url}" alt="" draggable="false" loading="lazy"><b class="gst-fx"></b></i>`;
}

/** Warstwy naklejek karty o numerze `uid` (cardHTML): `photo` idzie do zdjęcia (nad nim), `card` nad całą kartą */
export function userStickers(uid: number | null | undefined, kind: 'photo' | 'card'): string {
  const list = uid != null ? (S.stk as StkData | null)?.placed[uid] : null;
  const mine = list?.filter(p => (kind === 'photo') === p.photo);
  return mine?.length ? `<div class="gst-layer gst-${kind}">${mine.map(p => stickerHTML(p)).join('')}</div>` : '';
}

/** Rysuje warstwy naklejek z listy w istniejącym elemencie `.card` (podgląd w edytorze, odświeżanie kart na ekranie) */
export function applyLayers(card: Element, list: StkPlacement[], selected?: number | null) {
  card.querySelectorAll('.gst-layer').forEach(l => l.remove());
  const make = (photo: boolean) => {
    const mine = list.filter(p => p.photo === photo);
    const el = document.createElement('div');
    el.className = `gst-layer gst-${photo ? 'photo' : 'card'}`;
    el.innerHTML = mine.map(p => stickerHTML(p, p.id === selected ? ' sel' : '')).join('');
    return el;
  };
  const photo = card.querySelector('.card-photo, .sc-art');
  if (photo) photo.appendChild(make(true));
  const shine = card.querySelector(':scope > .shine');
  const layer = make(false);
  if (shine) card.insertBefore(layer, shine); else card.appendChild(layer);
}

/** Po zmianie naklejek: odświeża wszystkie karty o tym numerze widoczne na ekranie (listy, podgląd) bez przerysowywania Reacta */
export function refreshCard(uid: number) {
  const list = (S.stk as StkData | null)?.placed[uid] ?? [];
  document.querySelectorAll(`.card[data-uid="${uid}"]`).forEach(c => applyLayers(c, list));
}

/** Zapamiętuje w S.stk położenia naklejek z odpowiedzi serwera (np. gablota cudzego profilu) */
export function mergePlaced(placed: Record<string, StkPlacement[]> | undefined) {
  if (!placed || !S.stk) return;
  Object.assign((S.stk as StkData).placed, placed);
}

// ---------------------------------------------------------------- okna (renderują je komponenty-hosty w App)

/** Edytor naklejania: `card` = numer karty (inaczej najpierw wybór karty), `sticker` = naklejka z ekwipunku do naklejenia od razu */
export function openStickerEditor(card?: number | null, sticker?: number | null) {
  S.stickerEdit = { card: card ?? null, sticker: sticker ?? null };
  touch();
}

export interface StkDrop { id: number; sticker: string; variant: string; name: string; rarity: string; v: number }

/** Otwiera skrzynki z naklejkami z ekwipunku i pokazuje, co wypadło */
export async function openStickerCrate(crateId: string, count = 1) {
  const d = await api<{ drops: StkDrop[]; chests: Record<string, number> }>('/api/stickers/open', { crate: crateId, count });
  S.chests = d.chests;
  S.animHold = (S.animHold || 0) + 1;   // wynik gry nie może wyprzedzić ekranu z wynikiem (EXP, osiągnięcia)
  S.stickerReveal = d.drops;
  await loadStickers();
}

export function closeStickerReveal() {
  S.stickerReveal = null;
  S.animHold = Math.max(0, (S.animHold || 1) - 1);
  touch();
}
