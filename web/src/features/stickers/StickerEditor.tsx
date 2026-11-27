import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCw, FlipHorizontal2, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { cardMatches, person } from '../../game/rules';
import { S, touch, useGame } from '../../game/store';
import type { Item } from '../../game/types';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { SearchField } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import { VARIANT_NAME, applyLayers, refreshCard, stickerTileHTML, type StkData, type StkItem, type StkPlacement } from './stickers';
import s from './Stickers.module.css';

// Naklejanie naklejek na kartę: podgląd karty z naklejkami, które się chwyta i przeciąga (nad zdjęciem albo nad całą kartą), suwaki rozmiaru i obrotu,
// naklejki z ekwipunku do dołożenia (najwyżej 10 na kartę). Dokładanie i zdejmowanie zapisuje się od razu, położenie po „Zapisz”.
// Serwer przyjmuje tylko liczby w granicach (server/src/routes/stickers.rs `clean_place`).

/** Okno edytora; otwiera je `openStickerEditor` (stickers.ts) */
export function StickerEditorHost() {
  const g = useGame();
  const e = g.stickerEdit as { card: number | null; sticker: number | null } | null;
  if (!e) return null;
  return <StickerEditor key={`${e.card}:${e.sticker}`} initial={e} onClose={() => { S.stickerEdit = null; touch(); }} />;
}

function StickerEditor({ initial, onClose }: { initial: { card: number | null; sticker: number | null }; onClose: () => void }) {
  const [card, setCard] = useState<number | null>(initial.card);
  if (card == null) return <PickCard onClose={onClose} onPick={setCard} />;
  const item = S.items.find(i => i.id === card);
  if (!item) { onClose(); return null; }
  return <Editor item={item} pending={initial.sticker} onClose={onClose} />;
}

function PickCard({ onClose, onPick }: { onClose: () => void; onPick: (id: number) => void }) {
  const g = useGame();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(40);
  // karty w wariancie Hologramowy nie przyjmują naklejek (serwer też to sprawdza: `stickers::allows_stickers`)
  const list = useMemo(() => g.items.filter(i => !i.variant.split('+').includes('hologram') && cardMatches(i, q)), [g.items, q]);
  return (
    <Modal title="Wybierz kartę, na którą chcesz nakleić naklejkę" onClose={onClose} huge>
      <SearchField value={q} onChange={e => { setQ(e.target.value); setLimit(40); }} placeholder="Szukaj: nazwa, wariant, rzadkość" aria-label="Szukaj kart" />
      <div className={s.pickGrid}>
        {list.slice(0, limit).map(i => (
          <button key={i.id} type="button" className={s.pickCard} onClick={() => onPick(i.id)} aria-label={`${person(i.person).name}, ${i.variant}`}>
            <Card person={i.person} variant={i.variant} uid={i.id} tilt={false} />
          </button>
        ))}
        {!list.length && <p className="muted">Nie masz kart pasujących do wyszukiwania.</p>}
      </div>
      {list.length > limit && <Button onClick={() => setLimit(l => l + 40)}>Pokaż więcej ({list.length - limit})</Button>}
    </Modal>
  );
}

const DEFAULT: Omit<StkPlacement, 'id' | 'item' | 'sticker' | 'variant'> = { x: 50, y: 50, w: 28, rot: 0, flip: false, photo: false };

function Editor({ item, pending, onClose }: { item: Item; pending: number | null; onClose: () => void }) {
  const g = useGame();
  const stk = g.stk as StkData;
  const p = person(item.person);
  const [draft, setDraft] = useState<StkPlacement[]>(() => (stk.placed[item.id] ?? []).map(x => ({ ...x })));
  const saved = useRef<StkPlacement[]>((stk.placed[item.id] ?? []).map(x => ({ ...x })));   // stan zgodny z serwerem
  const [sel, setSel] = useState<number | null>(null);
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const pendingUsed = useRef(false);

  // warstwy naklejek rysowane w prawdziwej karcie, tak samo jak na ekranie gry (co widzisz, to dostaniesz)
  useEffect(() => {
    const el = wrap.current?.querySelector('.card');
    if (el) applyLayers(el, draft, sel);
  }, [draft, sel]);

  const box = (photo: boolean) => wrap.current?.querySelector(photo ? '.card-photo, .sc-art' : '.card') as HTMLElement | null;
  const patch = (id: number, d: Partial<StkPlacement>) => {
    setDraft(list => list.map(x => (x.id === id ? { ...x, ...d } : x)));
    setDirty(set => new Set(set).add(id));
  };
  const cur = draft.find(x => x.id === sel) ?? null;

  const down = (e: React.PointerEvent) => {
    const el = (e.target as HTMLElement).closest('.gst[data-pid]') as HTMLElement | null;
    if (!el) return setSel(null);
    const id = +el.dataset.pid!, st = draft.find(x => x.id === id)!, r = box(st.photo)?.getBoundingClientRect();
    if (!r) return;
    setSel(id);
    drag.current = { id, dx: st.x - ((e.clientX - r.left) / r.width) * 100, dy: st.y - ((e.clientY - r.top) / r.height) * 100 };
    wrap.current?.classList.add('dragging');
    wrap.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const st = draft.find(x => x.id === d.id);
    const r = st && box(st.photo)?.getBoundingClientRect();
    if (!st || !r) return;
    patch(d.id, { x: Math.round((((e.clientX - r.left) / r.width) * 100 + d.dx) * 10) / 10, y: Math.round((((e.clientY - r.top) / r.height) * 100 + d.dy) * 10) / 10 });
  };
  const up = () => { drag.current = null; wrap.current?.classList.remove('dragging'); };

  // przełączenie „na zdjęciu / nad kartą” zachowuje miejsce naklejki na ekranie (przelicza % na drugi kontener)
  const setPhoto = (on: boolean) => {
    if (!cur) return;
    const a = box(cur.photo)?.getBoundingClientRect(), b = box(on)?.getBoundingClientRect();
    if (!a || !b) return patch(cur.id, { photo: on });
    const cx = a.left + (cur.x / 100) * a.width, cy = a.top + (cur.y / 100) * a.height, wpx = (cur.w / 100) * a.width;
    patch(cur.id, { photo: on, x: Math.round(((cx - b.left) / b.width) * 1000) / 10, y: Math.round(((cy - b.top) / b.height) * 1000) / 10, w: Math.min(90, Math.max(6, Math.round((wpx / b.width) * 1000) / 10)) });
  };

  const attach = async (it: StkItem) => {
    if (busy || draft.length >= stk.max) return;
    setBusy(true);
    try {
      const d = await api<{ placement: StkPlacement }>('/api/stickers/attach', { id: it.id, card: item.id, ...DEFAULT });
      stk.items = stk.items.filter(x => x.id !== it.id);
      saved.current = [...saved.current, d.placement];
      setDraft(l => [...l, { ...d.placement }]);
      setSel(d.placement.id);
      Sound.click();
    } catch (e: any) { Sound.error(); toast(e.message, true); }
    setBusy(false);
  };
  const detach = async (id: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api<{ item: StkItem }>('/api/stickers/detach', { id });
      stk.items = [d.item, ...stk.items];
      saved.current = saved.current.filter(x => x.id !== id);
      setDraft(l => l.filter(x => x.id !== id));
      setDirty(set => { const n = new Set(set); n.delete(id); return n; });
      if (sel === id) setSel(null);
      Sound.click();
    } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };

  // naklejka wybrana w ekwipunku, zanim wybrano kartę: naklejamy ją od razu
  useEffect(() => {
    if (pending == null || pendingUsed.current) return;
    pendingUsed.current = true;
    const it = stk.items.find(x => x.id === pending);
    if (it) void attach(it);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (keep: StkPlacement[]) => {
    stk.placed[item.id] = keep;
    if (!keep.length) delete stk.placed[item.id];
    refreshCard(item.id);
    touch();
    onClose();
  };
  const save = async () => {
    setBusy(true);
    try {
      for (const id of dirty) {
        const x = draft.find(d => d.id === id);
        if (x) await api('/api/stickers/update', { id, x: x.x, y: x.y, w: x.w, rot: x.rot, flip: x.flip, photo: x.photo });
      }
      toast('Zapisano naklejki na karcie');
      finish(draft);
    } catch (e: any) { toast(e.message, true); setBusy(false); }
  };
  const close = () => {
    if (dirty.size && !confirm('Zamknąć bez zapisania zmian położenia naklejek?')) return;
    finish(saved.current);
  };

  const free = stk.max - draft.length;
  return (
    <Modal title={`Naklejki: ${p.name}`} onClose={close} huge>
      <div className={s.layout}>
        <div className={s.stageBox}>
          <div ref={wrap} className={`gst-edit ${s.preview}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <Card person={item.person} variant={item.variant} uid={null} tilt={false} />
          </div>
          <p className="muted small">Przeciągnij naklejkę, żeby ją przesunąć. Naklejka nad zdjęciem leży na nim, inna - nad całą kartą.</p>
        </div>

        <div className={s.panelSide}>
          <h3>Na karcie ({draft.length}/{stk.max})</h3>
          <div className={s.chips}>
            {draft.map(x => (
              <button key={x.id} type="button" className={`${s.chipBtn}${x.id === sel ? ` ${s.active}` : ''}`} onClick={() => setSel(x.id)} aria-pressed={x.id === sel}>
                <span className={s.thumb} dangerouslySetInnerHTML={{ __html: stickerTileHTML(x.sticker, x.variant) }} />
                <small>{stk.catalog[x.sticker]?.name} · {VARIANT_NAME[x.variant]}</small>
              </button>
            ))}
            {!draft.length && <span className="muted small">Brak naklejek na tej karcie.</span>}
          </div>

          {cur && (
            <div className={s.controls}>
              <label>Rozmiar<input type="range" min={6} max={90} value={cur.w} onChange={e => patch(cur.id, { w: +e.target.value })} aria-label="Rozmiar naklejki" /></label>
              <label><RotateCw size={14} aria-hidden="true" /> Obrót<input type="range" min={-180} max={180} value={cur.rot} onChange={e => patch(cur.id, { rot: +e.target.value })} aria-label="Obrót naklejki" /></label>
              <div className={s.line}>
                <Button onClick={() => patch(cur.id, { flip: !cur.flip })}><FlipHorizontal2 size={15} aria-hidden="true" /> Odbij</Button>
                <label className={s.chk}><input type="checkbox" checked={cur.photo} onChange={e => setPhoto(e.target.checked)} /> Na zdjęciu</label>
                <Button onClick={() => detach(cur.id)} disabled={busy}><Trash2 size={15} aria-hidden="true" /> Zdejmij z karty</Button>
              </div>
            </div>
          )}

          <h3>Twoje naklejki ({stk.items.length})</h3>
          {free <= 0 && <p className="muted small">Karta ma już {stk.max} naklejek. Zdejmij którąś, żeby dołożyć inną.</p>}
          <div className={s.inv}>
            {stk.items.map(it => (
              <button key={it.id} type="button" className={s.invItem} disabled={free <= 0 || busy} onClick={() => attach(it)} title={`${stk.catalog[it.sticker]?.name} (${VARIANT_NAME[it.variant]}): naklej`}>
                <span dangerouslySetInnerHTML={{ __html: stickerTileHTML(it.sticker, it.variant) }} />
              </button>
            ))}
            {!stk.items.length && <span className="muted small">Nie masz wolnych naklejek. Dostaniesz je ze skrzynek z naklejkami.</span>}
          </div>

          <div className={s.line}>
            <Button kind="hue" onClick={save} disabled={busy}>Zapisz</Button>
            <Button onClick={close}>Zamknij</Button>
            {dirty.size > 0 && <span className={s.dirty}>Niezapisane zmiany</span>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
