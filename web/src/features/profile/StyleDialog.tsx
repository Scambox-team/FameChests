import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lock } from 'lucide-react';
import { api } from '../../api/client';
import { useGame } from '../../game/store';
import { refreshBadges } from '../../game/session';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Tabs } from '../../ui/Field';
import { FramedAvatar } from '../../ui/FramedAvatar';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import { countryOptions } from './countries';
import { AUTO_LABEL, useCosmeticSrc, type CosmeticView } from './cosmetics';
import pk from './playerCard.module.css';
import s from './styleDialog.module.css';

type Kind = 'mini' | 'frame' | 'bg' | 'avatar';
interface Item extends CosmeticView { unlocked: boolean; source: string }
interface Data {
  kinds: { key: Kind; label: string; w: number; h: number }[]; items: Item[];
  equipped: Record<Kind, string>; inventoryVisible: 'friends' | 'nobody';
  about: { bio: string; country: string; bioMax: number };
}

const TAB_LABEL: Record<Kind, string> = { mini: 'Tło miniprofilu', frame: 'Obramówka', bg: 'Tło profilu', avatar: 'Zdjęcie profilowe' };

/** Podgląd na żywo: miniprofil z wybranym tłem i obramówką (te same warstwy co prawdziwy miniprofil) */
function MiniPreview({ mini, frame, bg, avatar }: { mini: CosmeticView | null; frame: CosmeticView | null; bg: CosmeticView | null; avatar: CosmeticView | null }) {
  const { me } = useGame();
  const miniSrc = useCosmeticSrc(mini);
  const bgSrc = useCosmeticSrc(bg);
  if (!me) return null;
  return (
    <div className={s.sdPreview}>
      {bgSrc && <div className={s.pvBg} style={{ backgroundImage: `url("${bgSrc}")` }} />}
      <div className={s.pvTone} />
      <div className={`${pk.pkCard} ${pk.pkStatic}`}>
        {miniSrc && <div className={pk.pkBg} style={{ backgroundImage: `url("${miniSrc}")` }} />}
        <div className={pk.pkTone} />
        <div className={pk.pkTop}>
          <FramedAvatar user={{ ...me, avatarImg: avatar?.url ?? null }} size={72} frame={frame} />
          <div className={pk.pkWho}>
            <b className={pk.pkNick}>{me.username}</b>
            <span className={pk.pkLine}><span className={pk.pkLv}>Podgląd</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ item, on, selected, onPick, kind }: { item: Item | null; on: boolean; selected: boolean; onPick: () => void; kind: Kind }) {
  const src = useCosmeticSrc(item);
  const locked = !!item && !item.unlocked;
  return (
    <button type="button" className={`${s.sdTile}${selected ? ` ${s.sdTileSel}` : ''}${locked ? ` ${s.sdTileLocked}` : ''}`} onClick={onPick} aria-pressed={selected}
      aria-label={item ? `${item.name}${locked ? ' (zablokowany)' : on ? ' (założony)' : ''}` : 'Standardowy wygląd'}>
      <span className={`${s.sdThumb} ${s[`sdThumb_${kind}`]}`}>
        {item ? <img src={src} alt="" draggable={false} loading="lazy" /> : <span className={s.sdNone}>Standardowy</span>}
        {locked && <span className={s.sdLock}><Lock size={18} aria-hidden="true" /></span>}
        {on && <span className={s.sdWorn}><Check size={13} aria-hidden="true" /> Założony</span>}
      </span>
      <b>{item ? item.name : 'Domyślny'}</b>
      {locked && <small className="muted">{item!.source ? `Jak zdobyć: ${AUTO_LABEL[item!.source] ?? item!.source}` : 'Zablokowany'}</small>}
    </button>
  );
}

/** Opis profilu i kraj: darmowe, dla każdego (widać je na profilu i w miniprofilu) */
function About({ about, onSaved }: { about: Data['about']; onSaved: () => void }) {
  const [bio, setBio] = useState(about.bio);
  const [country, setCountry] = useState(about.country);
  const [busy, setBusy] = useState(false);
  const dirty = bio !== about.bio || country !== about.country;
  const save = async () => {
    setBusy(true);
    try { await api('/api/profile/about', { bio, country }); Sound.click(); toast('Zapisano opis i kraj'); onSaved(); }
    catch (e: any) { Sound.error(); toast(e.message, true); }
    setBusy(false);
  };
  return (
    <section className={s.sdPrivacy} aria-label="Opis i kraj">
      <h3>O mnie</h3>
      <label className={s.sdField}><span className="muted small">Opis profilu ({bio.length} / {about.bioMax})</span>
        <textarea value={bio} maxLength={about.bioMax} rows={3} onChange={e => setBio(e.target.value)} placeholder="Kilka słów o sobie" /></label>
      <label className={s.sdField}><span className="muted small">Kraj</span>
        <select value={country} onChange={e => setCountry(e.target.value)}>
          <option value="">Nie podaję</option>
          {countryOptions().map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select></label>
      <div className={s.sdBtns}><Button kind="hue" disabled={busy || !dirty} onClick={save}>Zapisz opis i kraj</Button></div>
    </section>
  );
}

/** Ekran „Wygląd profilu”: tło miniprofilu, obramówka zdjęcia i tło profilu (po jednym naraz) + kto widzi mój ekwipunek */
export function StyleDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data, refetch } = useQuery<Data>({ queryKey: ['cosmetics'], queryFn: () => api('/api/cosmetics'), staleTime: 0 });
  const [tab, setTab] = useState<Kind>('mini');
  const [sel, setSel] = useState<Partial<Record<Kind, string>>>({});
  const [busy, setBusy] = useState(false);
  if (!data) return <Modal title="Wygląd profilu" onClose={onClose}><p className="muted">Ładowanie</p></Modal>;

  const items = data.items.filter(i => i.kind === tab);
  const picked = (k: Kind) => (sel[k] !== undefined ? sel[k]! : data.equipped[k]);
  const find = (k: Kind): Item | null => data.items.find(i => i.id === picked(k)) ?? null;
  const kind = data.kinds.find(k => k.key === tab)!;
  const cur = picked(tab);
  const curItem = items.find(i => i.id === cur) ?? null;
  const changed = cur !== data.equipped[tab];
  const apply = async (kindKey: Kind, id: string) => {
    setBusy(true);
    try {
      await api('/api/cosmetics/equip', { kind: kindKey, id });
      Sound.click();
      toast(id ? 'Kosmetyk założony' : 'Wrócono do standardowego wyglądu');
      setSel(x => { const n = { ...x }; delete n[kindKey]; return n; });
      await refetch();
      qc.invalidateQueries({ queryKey: ['user'] });
      onChanged();
      refreshBadges();   // własne zdjęcie profilowe: odśwież swoje dane (ikona w pasku i na liście)
    } catch (e: any) { Sound.error(); toast(e.message, true); }
    setBusy(false);
  };
  const privacy = async (v: 'friends' | 'nobody') => {
    try { await api('/api/profile/privacy', { inventory: v }); Sound.click(); toast(v === 'friends' ? 'Ekwipunek widzą znajomi' : 'Ekwipunek jest ukryty'); refetch(); qc.invalidateQueries({ queryKey: ['user'] }); }
    catch (e: any) { Sound.error(); toast(e.message, true); }
  };

  return (
    <Modal title="Wygląd profilu" onClose={onClose} wide>
      <MiniPreview mini={find('mini')} frame={find('frame')} bg={find('bg')} avatar={find('avatar')} />
      <Tabs label="Rodzaj kosmetyku" value={tab} onChange={v => { setTab(v); Sound.click(); }}
        items={data.kinds.map(k => ({ id: k.key, label: TAB_LABEL[k.key] ?? k.label, count: data.items.filter(i => i.kind === k.key && i.unlocked).length }))} />
      <p className="muted small">Standardowo masz tylko podstawowy wygląd. Kosmetyki zdobywasz za questy, osiągnięcia, eventy, levele i inne nagrody. Naraz możesz mieć jedno tło miniprofilu, jedną obramówkę i jedno tło profilu.</p>
      <div className={s.sdGrid}>
        <Tile item={null} kind={tab} on={!data.equipped[tab]} selected={cur === ''} onPick={() => setSel({ ...sel, [tab]: '' })} />
        {items.map(i => <Tile key={i.id} item={i} kind={tab} on={data.equipped[tab] === i.id} selected={cur === i.id} onPick={() => setSel({ ...sel, [tab]: i.id })} />)}
      </div>
      {!items.length && <p className="muted small">Na razie nie ma tu żadnych pozycji ({kind.label.toLowerCase()}).</p>}
      <div className={s.sdBtns}>
        {changed && (cur === '' || curItem?.unlocked) && <Button kind="hue" disabled={busy} onClick={() => apply(tab, cur)}>{cur === '' ? 'Zdejmij' : 'Załóż'}</Button>}
        {changed && curItem && !curItem.unlocked && <span className="muted small">Ta pozycja jest jeszcze zablokowana.</span>}
        <Button onClick={onClose}>Zamknij</Button>
      </div>
      <About about={data.about} onSaved={() => { refetch(); qc.invalidateQueries({ queryKey: ['user'] }); onChanged(); }} />
      <section className={s.sdPrivacy} aria-label="Prywatność ekwipunku">
        <h3>Kto widzi mój ekwipunek</h3>
        <p className="muted small">Znajomi mogą przeglądać wszystkie twoje karty i proponować z nich wymianę albo kupno. Możesz to wyłączyć.</p>
        <div role="radiogroup" aria-label="Kto widzi ekwipunek" className={s.sdRadios}>
          <label><input type="radio" name="inv" checked={data.inventoryVisible === 'friends'} onChange={() => privacy('friends')} /> Znajomi (domyślnie)</label>
          <label><input type="radio" name="inv" checked={data.inventoryVisible === 'nobody'} onChange={() => privacy('nobody')} /> Nikt</label>
        </div>
      </section>
    </Modal>
  );
}
