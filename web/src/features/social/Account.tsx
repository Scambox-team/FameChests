import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { SortSelect, UNIQUE_SORTS } from '../../cards/cardSorts';
import { cardMatches, imgUrl, isSpecial, person, sortCards, variantName, vClass, vtClass } from '../../game/rules';
import { S, touch, useGame } from '../../game/store';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { SearchField } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import s from './social.module.css';

/** Ikona gracza: zdjęcie karty, którą ma, w każdym posiadanym wariancie */
export function AvatarPicker({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { items, me } = useGame();
  const [sort, setSort] = useState('rarity');
  const [q, setQ] = useState('');
  const mine = useMemo(() => {
    const combos: Record<string, any> = {};
    items.forEach(i => { if (person(i.person)) combos[`${i.person}|${i.variant}`] ||= { person: i.person, variant: i.variant, value: i.value }; });
    return sortCards(Object.values(combos), sort);
  }, [items, sort]);

  const save = async (body: any, ok: string) => {
    try {
      const res = await api('/api/profile', body);
      S.me = res.user;
      touch();
      Sound.click();
      toast(ok);
      onChanged();
      onClose();
    } catch (e: any) { toast(e.message, true); }
  };
  const list = mine.filter((c: any) => cardMatches(c, q));
  return (
    <Modal title="Ikona gracza" onClose={onClose} wide>
      <p className="muted small">Ikoną może być każda karta, którą masz, w każdym wariancie, który masz.</p>
      <div className={s.colTools}>
        <SearchField value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj" aria-label="Szukaj karty" />
        <SortSelect value={sort} options={UNIQUE_SORTS} onChange={setSort} />
        {me?.avatarCard && <Button onClick={() => save({ avatar: me.avatar || '😎' }, 'Ikona z karty usunięta')}>Bez karty</Button>}
      </div>
      <div className={s.avatars}>
        {list.map((c: any) => {
          const p = person(c.person), R = S.cfg.rarities[p.rarity], secret = p.rarity === 'secret';
          const active = c.person === me?.avatarCard && c.variant === (me?.avatarVariant || 'normal');
          return (
            <button key={`${c.person}|${c.variant}`} type="button" className={`${s.avatarOpt}${active ? ` ${s.avatarOn}` : ''}`} style={{ '--rc': R.color } as React.CSSProperties} title={`${p.name}, ${variantName(c.variant)}`}
              onClick={() => save({ avatarCard: c.person, avatarVariant: c.variant }, `Nowa ikona: ${p.name}${isSpecial(c.variant) ? ` (${variantName(c.variant)})` : ''}`)}>
              <span className={`av-card ${vClass(c.variant, 'avv-')}${secret ? ' av-secret' : ''}`}><img src={imgUrl(c.person, null, true)} alt="" loading="lazy" draggable={false} /></span>
              <span>{p.name}</span>
              {isSpecial(c.variant) && <small className={vtClass(c.variant)}>{variantName(c.variant)}</small>}
            </button>
          );
        })}
        {!mine.length && <p className="muted">Nie masz jeszcze żadnych kart. Otwórz skrzynkę.</p>}
      </div>
    </Modal>
  );
}

export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (f.new !== f.new2) return toast('Nowe hasła nie są takie same', true);
    try { await api('/api/password', { old: f.old, new: f.new }); toast('Hasło zmienione'); onClose(); }
    catch (err: any) { toast(err.message, true); }
  };
  return (
    <Modal title="Zmień hasło" onClose={onClose}>
      <form className={s.form} onSubmit={submit}>
        <label>Obecne hasło<input type="password" name="old" required autoComplete="current-password" /></label>
        <label>Nowe hasło<input type="password" name="new" required minLength={8} autoComplete="new-password" /></label>
        <label>Powtórz nowe hasło<input type="password" name="new2" required minLength={8} autoComplete="new-password" /></label>
        <div className={s.btns}><Button kind="hue" type="submit">Zapisz</Button><Button type="button" onClick={onClose}>Anuluj</Button></div>
      </form>
    </Modal>
  );
}

/** Email konta: do odzyskania hasła. Gracze sprzed emaili dopisują go tutaj (potwierdzają linkiem z maila). */
export function EmailDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ enabled: boolean; email: string | null } | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => { api('/api/email').then(setInfo).catch((e: any) => toast(e.message, true)); }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      const res = await api('/api/email', { email: f.email, password: f.password });
      if (res.confirm) setSent(true);
      else { toast('Email dodany'); onClose(); }
    } catch (err: any) { toast(err.message, true); }
  };
  return (
    <Modal title="Email konta" onClose={onClose}>
      {!info && <p className="muted">Wczytuję…</p>}
      {info && !info.enabled && <p className="muted">Na tym serwerze konta nie mają emaili.</p>}
      {info?.enabled && info.email && <p>Twoje konto ma email <b>{info.email}</b>. Użyjesz go, żeby odzyskać hasło („Nie pamiętasz hasła?” na stronie logowania).</p>}
      {info?.enabled && !info.email && sent && <p>Wysłaliśmy link potwierdzający na podany adres. Kliknij w niego, żeby dokończyć. Sprawdź też folder ze spamem.</p>}
      {info?.enabled && !info.email && !sent && (
        <form className={s.form} onSubmit={submit}>
          <p className="muted small">Bez emaila nie odzyskasz hasła, jeśli je zapomnisz. Po dodaniu możesz logować się też samym emailem.</p>
          <label>Email<input type="email" name="email" required maxLength={254} autoComplete="email" /></label>
          <label>Obecne hasło<input type="password" name="password" required autoComplete="current-password" /></label>
          <div className={s.btns}><Button kind="hue" type="submit">Dodaj email</Button><Button type="button" onClick={onClose}>Anuluj</Button></div>
        </form>
      )}
      {info?.enabled && (info.email || sent) && <div className={s.btns}><Button type="button" onClick={onClose}>Zamknij</Button></div>}
    </Modal>
  );
}
