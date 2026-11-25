import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crown, Package, Repeat, Search, UserCheck, UserMinus, UserPlus, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { refreshBadges } from '../../game/session';
import { S } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import { FramedAvatar } from '../../ui/FramedAvatar';
import { ServiceBadge } from '../exp/LevelPage';
import { TradeBuilder } from '../social/TradeBuilder';
import { countryName, flagUrl } from './countries';
import { useCosmeticSrc, type ProfileStyle } from './cosmetics';
import { FriendInventory } from './FriendInventory';
import s from './playerCard.module.css';

// Miniprofil gracza (jak na Steamie): jeden komponent i jeden mechanizm dla CAŁEJ gry. `PlayerCardHost` stoi raz w AppShell i nasłuchuje na
// dokumencie; miniprofil otwiera każdy element z `data-player="<nazwa>"` (`UserLink`, `PlayerName`) oraz każdy link do `/player/<nazwa>`.
// Komputer: najechanie myszą (z krótkim opóźnieniem, bez migotania); klawiatura: fokus pokazuje kartę, strzałka w dół wchodzi do niej, Esc zamyka;
// telefon: pierwsze dotknięcie pokazuje kartę (zamiast przejścia do profilu), przycisk „Profil” w niej otwiera profil.

interface Mini {
  user: { id: number; username: string; isAdmin: boolean; avatar: string; avatarCard?: string | null; avatarRarity?: string | null; avatarVariant?: string | null };
  created: number; relation: 'me' | 'none' | 'friend' | 'outgoing' | 'incoming';
  level: number; badge: { year: number; tier: number; name: string } | null; role: string; online: boolean;
  stats: { value: number; unique: number; total: number; opened: number };
  style: ProfileStyle; inventory: boolean; canTrade: boolean; bio?: string; country?: string;
}

const TTL = 25_000;
const cache = new Map<string, { at: number; p: Promise<Mini> }>();
const key = (name: string) => name.toLowerCase();

function loadMini(name: string, fresh = false): Promise<Mini> {
  const hit = cache.get(key(name));
  if (hit && !fresh && Date.now() - hit.at < TTL) return hit.p;
  const p = api<Mini>(`/api/users/${encodeURIComponent(name)}/mini`);
  cache.set(key(name), { at: Date.now(), p });
  p.catch(() => cache.delete(key(name)));
  return p;
}

const TARGET = '[data-player], a[href^="/player/"]';
const nameOf = (el: Element): string => {
  const d = el.getAttribute('data-player');
  if (d) return d;
  try { return decodeURIComponent((el.getAttribute('href') || '').split('/')[2] || ''); } catch { return ''; }
};
/** Element, który otwiera miniprofil (poza samą kartą i miejscami oznaczonymi `data-no-mini`) */
const targetOf = (node: EventTarget | null): HTMLElement | null => {
  const el = node instanceof Element ? node.closest<HTMLElement>(TARGET) : null;
  return el && !el.closest('[data-no-mini]') && !el.closest(`.${s.pkCard}`) && nameOf(el) ? el : null;
};

const CARD_ID = 'player-card';

function Card({ mini, anchor, onClose, openTrade, openInv, reload, via }: {
  mini: Mini; anchor: HTMLElement; onClose: () => void; openTrade: () => void; openInv: () => void; reload: () => void; via: 'pointer' | 'key' | 'tap';
}) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const u = mini.user, mine = mini.relation === 'me';
  const bg = useCosmeticSrc(mini.style.mini);

  // pozycja pod nazwą (albo nad nią, gdy brakuje miejsca), zawsze w całości na ekranie
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const r = anchor.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight, vw = innerWidth, vh = innerHeight;
    let top = r.bottom + 8;
    if (top + h > vh - 8) top = r.top - h - 8 >= 8 ? r.top - h - 8 : Math.max(8, vh - h - 8);
    setPos({ left: Math.min(Math.max(8, r.left), Math.max(8, vw - w - 8)), top });
  }, [anchor, mini]);

  useEffect(() => {
    if (via === 'key') anchor.setAttribute('aria-describedby', CARD_ID);
    return () => anchor.removeAttribute('aria-describedby');
  }, [anchor, via]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok); Sound.click(); } catch (e: any) { Sound.error(); toast(e.message, true); }
    refreshBadges();
    reload();
  };
  const friendAct = (path: string, body: object, ok?: string) => act(() => api(path, body), ok);
  const go = () => { onClose(); navigate(`/player/${encodeURIComponent(u.username)}`); };

  return createPortal(
    <div ref={ref} id={CARD_ID} className={s.pkCard} role="dialog" aria-label={`Miniprofil gracza ${u.username}`} data-player-card
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      {bg && <div className={s.pkBg} style={{ backgroundImage: `url("${bg}")` }} />}
      <div className={s.pkTone} />
      <button type="button" className={s.pkClose} aria-label="Zamknij miniprofil" onClick={onClose}><X size={15} aria-hidden="true" /></button>
      <div className={s.pkTop}>
        <FramedAvatar user={u} size={72} frame={mini.style.frame} />
        <div className={s.pkWho}>
          <b className={s.pkNick}>{u.username}{u.isAdmin && <Crown size={15} aria-label="Admin" />}</b>
          <span className={s.pkLine}>
            <span className={s.pkLv}>Level {mini.level}</span>
            {mini.badge && <span className={s.pkSvc} title={`Za służbę w roku ${mini.badge.year} (${mini.badge.name})`}><ServiceBadge year={mini.badge.year} tier={mini.badge.tier} className={s.pkSvcArt} /></span>}
          </span>
          <span className={s.pkLine}>
            <span className={`${s.pkDot}${mini.online ? ` ${s.pkOn}` : ''}`} aria-hidden="true" />
            <span className="small">{mini.online ? 'Online' : 'Offline'}</span>
            {mini.role === 'admin' && <span className={s.pkRole}>Admin</span>}
          </span>
        </div>
      </div>
      {(mini.country || mini.bio) && (
        <div className={s.pkAbout}>
          {mini.country && <span className={s.pkCountry}><img src={flagUrl(mini.country)} alt="" />{countryName(mini.country)}</span>}
          {mini.bio && <p>{mini.bio}</p>}
        </div>
      )}
      <dl className={s.pkStats}>
        <div><dt>Kolekcja</dt><dd>{fmt(mini.stats.value)}</dd></div>
        <div><dt>Unikalne</dt><dd>{mini.stats.unique}/{Object.keys(S.cfg.people).length}</dd></div>
        <div><dt>Karty</dt><dd>{mini.stats.total}</dd></div>
        <div><dt>Skrzynki</dt><dd>{mini.stats.opened}</dd></div>
      </dl>
      <div className={s.pkActs}>
        {mini.relation === 'none' && <button type="button" className={s.pkHue} onClick={() => friendAct('/api/friends/request', { username: u.username }, 'Wysłano zaproszenie')}><UserPlus size={15} aria-hidden="true" />Dodaj do znajomych</button>}
        {mini.relation === 'outgoing' && <button type="button" onClick={() => friendAct('/api/friends/remove', { username: u.username }, 'Zaproszenie anulowane')}><UserCheck size={15} aria-hidden="true" />Zaproszenie wysłane · anuluj</button>}
        {mini.relation === 'incoming' && <button type="button" className={s.pkHue} onClick={() => friendAct('/api/friends/respond', { username: u.username, accept: true }, 'Nowy znajomy')}><UserCheck size={15} aria-hidden="true" />Przyjmij zaproszenie</button>}
        {mini.relation === 'friend' && <button type="button" onClick={() => { if (confirm(`Usunąć ${u.username} ze znajomych?`)) friendAct('/api/friends/remove', { username: u.username }); }}><UserMinus size={15} aria-hidden="true" />Usuń ze znajomych</button>}
        <button type="button" onClick={go}><Search size={15} aria-hidden="true" />{mine ? 'Mój profil' : 'Profil'}</button>
        {mini.canTrade && <button type="button" onClick={() => { onClose(); openTrade(); }}><Repeat size={15} aria-hidden="true" />Wymiana</button>}
        {mini.inventory && !mine && <button type="button" onClick={() => { onClose(); openInv(); }}><Package size={15} aria-hidden="true" />Ekwipunek</button>}
      </div>
    </div>,
    document.body
  );
}

/** Raz w AppShell: nasłuch na dokumencie, karta i okna wywoływane z karty (wymiana, ekwipunek znajomego) */
export function PlayerCardHost() {
  const [open, setOpen] = useState<{ name: string; anchor: HTMLElement; via: 'pointer' | 'key' | 'tap' } | null>(null);
  const [mini, setMini] = useState<Mini | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'trade' | 'inv'; name: string }>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const timers = useRef<{ open?: number; close?: number }>({});
  const touch = useRef(false);

  const close = useCallback((refocus = false) => {
    clearTimeout(timers.current.open); clearTimeout(timers.current.close);
    const a = openRef.current?.anchor;
    setOpen(null);
    if (refocus && a?.isConnected) a.focus({ preventScroll: true });
  }, []);

  const show = useCallback((el: HTMLElement, via: 'pointer' | 'key' | 'tap') => {
    clearTimeout(timers.current.close);
    const name = nameOf(el);
    if (openRef.current?.anchor === el) return;
    setMini(null);
    setOpen({ name, anchor: el, via });
  }, []);

  // dane: z pamięci przeglądarki (25 s), nieznany albo ukryty gracz = bez karty
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadMini(open.name).then(m => { if (live) setMini(m); }).catch(() => { if (live) close(); });
    return () => { live = false; };
  }, [open?.name, close]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const inCard = (n: EventTarget | null) => n instanceof Element && !!n.closest('[data-player-card]');
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = targetOf(e.target);
      if (el) {
        clearTimeout(timers.current.close);
        if (openRef.current?.anchor === el) return;
        clearTimeout(timers.current.open);
        timers.current.open = window.setTimeout(() => show(el, 'pointer'), openRef.current ? 120 : 380);
      } else if (inCard(e.target)) clearTimeout(timers.current.close);
    };
    const onOut = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const from = targetOf(e.target) ?? (inCard(e.target) ? e.target : null);
      if (!from) return;
      const to = e.relatedTarget;
      if (to && (targetOf(to) === from || inCard(to) || (from instanceof Element && from.contains(to as Node)))) return;
      clearTimeout(timers.current.open);
      if (openRef.current?.via === 'pointer') timers.current.close = window.setTimeout(() => close(), 260);
    };
    const onFocus = (e: FocusEvent) => {
      const el = targetOf(e.target);
      if (el && el.matches(':focus-visible')) show(el, 'key');
    };
    const onKey = (e: KeyboardEvent) => {
      const cur = openRef.current;
      if (!cur) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(true); }
      else if (e.key === 'ArrowDown' && document.activeElement === cur.anchor) {
        const first = document.querySelector<HTMLElement>('[data-player-card] button:not([aria-label^="Zamknij"])');
        if (first) { e.preventDefault(); first.focus(); }
      }
    };
    const onDown = (e: PointerEvent) => {
      touch.current = e.pointerType === 'touch';
      if (openRef.current && !inCard(e.target) && !targetOf(e.target)) close();
    };
    // telefon: pierwsze dotknięcie nazwy pokazuje kartę (link nie przechodzi), drugie w tę samą nazwę idzie dalej
    const onClick = (e: MouseEvent) => {
      const el = targetOf(e.target);
      if (!el || !touch.current) return;
      if (openRef.current?.anchor === el) return;
      e.preventDefault(); e.stopPropagation();
      show(el, 'tap');
    };
    const onFocusOut = (e: FocusEvent) => {
      const cur = openRef.current;
      if (cur?.via !== 'key') return;
      const to = e.relatedTarget as Node | null;
      if (to && (inCard(to) || (to instanceof Element && targetOf(to)))) return;
      if (!to) return;
      close();
    };
    const onScroll = () => { if (openRef.current && openRef.current.via !== 'tap') close(); };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      clearTimeout(timers.current.open); clearTimeout(timers.current.close);
    };
  }, [show, close]);

  const reload = () => { if (!open) return; loadMini(open.name, true).then(setMini).catch(() => {}); };
  return (
    <>
      {open && mini && mini.user.username.toLowerCase() === open.name.toLowerCase() && open.anchor.isConnected && (
        <Card mini={mini} anchor={open.anchor} via={open.via} onClose={() => close(true)} reload={reload}
          openTrade={() => setDialog({ kind: 'trade', name: mini.user.username })} openInv={() => setDialog({ kind: 'inv', name: mini.user.username })} />
      )}
      {dialog?.kind === 'trade' && <TradeBuilder username={dialog.name} onClose={() => setDialog(null)} onSent={() => {}} />}
      {dialog?.kind === 'inv' && <FriendInventory username={dialog.name} onClose={() => setDialog(null)} />}
    </>
  );
}
