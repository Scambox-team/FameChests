import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent, type KeyboardEvent as RKeyEvent, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, Gamepad2, LibraryBig, Menu, MoreHorizontal, ScrollText, Search, Settings, Users, X, type LucideIcon } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Logo } from '../../app/Logo';
import { ADMIN_GROUPS, ITEM_KEY, LEGACY_HASH, allItems, itemHref, type AdminItem } from './adminMenu';
import { bindDesigner, renderDesigner } from './designer';
import { renderMockups } from './mockups';
import { norm, watchLists } from './listSearch';
import { watchTables } from './mobileTables';
import panelHtml from './panel.html?raw';
import { startPanel } from './panel';
import { showSection } from './sections';
import { renderStickers } from './stickers';
import { renderVariants } from './variants';

import { api } from '../../api/client';

const ReportsAdmin = lazy(() => import('./ReportsAdmin'));
const BackupsAdmin = lazy(() => import('./BackupsAdmin'));
const GamesAdmin = lazy(() => import('./GamesAdmin'));
const EventsAdmin = lazy(() => import('./EventsAdmin'));
const ReferralsAdmin = lazy(() => import('./ReferralsAdmin'));
import './admin.css';
import styles from './AdminApp.module.css';

// Formularze panelu są gotowym HTML, a każdy widok rysuje się sam w swoim elemencie.
// Strony (nie panele z panel.html) otwierają się pełnym przeładowaniem, więc każdy widok startuje raz.
function View({ id, start }: { id: string; start: () => void }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    start();
  }, [start]);
  return <div id={id} />;
}

function Panel() {
  const box = useRef<HTMLDivElement>(null), done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    startPanel();
  }, []);
  return <div ref={box} dangerouslySetInnerHTML={{ __html: panelHtml }} />;
}

const startDesigner = () => { bindDesigner(); renderDesigner(); };

function page(path: string): ReactNode {
  if (path === '/variants') return <View id="variantsBody" start={renderVariants} />;
  if (path === '/stickers') return <View id="stickersBody" start={renderStickers} />;
  if (path === '/designer') return <View id="designerBody" start={startDesigner} />;
  if (path === '/mockups') return <View id="mockupsBody" start={renderMockups} />;
  if (path === '/admin/reports') return <Suspense fallback={null}><ReportsAdmin /></Suspense>;
  if (path === '/admin/events') return <Suspense fallback={null}><EventsAdmin /></Suspense>;
  if (path === '/admin/games') return <Suspense fallback={null}><GamesAdmin /></Suspense>;
  if (path === '/admin/referrals') return <Suspense fallback={null}><ReferralsAdmin /></Suspense>;
  if (path === '/admin/backups') return <Suspense fallback={null}><BackupsAdmin /></Suspense>;
  return <Panel />;
}

const GROUP_ICON: Record<string, LucideIcon> = { katalog: LibraryBig, gracze: Users, tresci: ScrollText, gry: Gamepad2, system: Settings };
type Entry = AdminItem & { group: string };
type Pick = (e: RMouseEvent, i: AdminItem) => void;

function hashId() {
  let h = '';
  try { h = decodeURIComponent(location.hash.slice(1)); } catch { /* zły adres */ }
  return LEGACY_HASH[h] ?? h;
}

// lista grup i pozycji (pasek boczny, okno „Menu” na telefonie i „Więcej” na komputerze)
function MenuList({ items, activeId, onPick, compact, openGroup, onToggle }: { items: Entry[]; activeId: string; onPick: Pick; compact?: boolean; openGroup?: string; onToggle?: (id: string) => void }) {
  const groups = ADMIN_GROUPS.map(g => ({ g, list: items.filter(i => g.items.some(x => x.id === i.id)) })).filter(x => x.list.length);
  if (!groups.length) return <p className={styles.none}>Nic nie znaleziono.</p>;
  return <>{groups.map(({ g, list }) => {
    const Icon = GROUP_ICON[g.id];
    return (
      <section key={g.id} className={`${styles.group} ${compact && g.id !== openGroup ? styles.folded : ''}`}>
        <h2 className={styles.gname}>{compact ? (
          <button type="button" className={styles.gbtn} onClick={() => onToggle?.(g.id)} aria-expanded={g.id === openGroup}>{Icon && <Icon size={15} aria-hidden="true" />} {g.label}<ChevronDown size={14} aria-hidden="true" className={styles.chev} /></button>
        ) : <>{Icon && <Icon size={15} aria-hidden="true" />} {g.label}</>}</h2>
        <ul>{list.map(i => (
          <li key={i.id}>
            <a href={itemHref(i)} onClick={e => onPick(e, i)} aria-current={i.id === activeId ? 'page' : undefined}>
              <span className={styles.lab}>{i.label}</span>
              <span className={styles.desc}>{i.desc}</span>
            </a>
          </li>
        ))}</ul>
      </section>
    );
  })}</>;
}

function MenuDialog({ items, activeId, q, setQ, onPick, onClose }: { items: Entry[]; activeId: string; q: string; setQ: (v: string) => void; onPick: Pick; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const body = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.querySelector<HTMLElement>('input')?.focus();
    return () => { document.body.style.overflow = body; prev?.focus?.(); };
  }, []);
  const keys = (e: RKeyEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(box.current!.querySelectorAll<HTMLElement>('a[href], button, input')).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className={styles.overlay} onKeyDown={keys} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.dialog} ref={box} role="dialog" aria-modal="true" aria-label="Menu panelu admina">
        <div className={styles.dhead}>
          <label className={styles.search}><Search size={16} aria-hidden="true" /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj w panelu" aria-label="Szukaj w panelu" /></label>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Zamknij menu"><X size={20} aria-hidden="true" /></button>
        </div>
        <nav className={styles.dbody} aria-label="Panel admina"><MenuList items={items} activeId={activeId} onPick={onPick} /></nav>
      </div>
    </div>
  );
}

export default function AdminApp() {
  const { pathname, search } = useLocation();
  const path = pathname.replace(/\/$/, '') === '/admin/mockups' ? '/mockups' : pathname.replace(/\/$/, '');
  const [owner, setOwner] = useState(false);
  const [hash, setHash] = useState(hashId);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [openG, setOpenG] = useState('');
  const nav = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const embed = new URLSearchParams(search).has('embed');

  const entries = allItems(owner) as Entry[];
  const needle = norm(q.trim());
  const shown = needle ? entries.filter(i => norm(`${i.label} ${i.desc} ${i.group}`).includes(needle)) : entries;

  // wybrana pozycja: strona po ścieżce, panel po #id
  const onPanel = path === '/admin';
  let item = entries.find(i => i.kind === 'page' && i.path === path);
  if (!item && onPanel) {
    let id = hash;
    if (!id) { try { id = localStorage.getItem(ITEM_KEY) || ''; } catch { /* bez pamięci przeglądarki */ } }
    item = entries.find(i => i.kind === 'panel' && i.id === id) ?? entries[0];
  }
  const activeId = item?.id ?? '';
  const title = item?.label ?? 'Panel admina';

  useEffect(() => { document.title = `${title} · ScamBox`; }, [title]);
  useEffect(() => { api<{ owner: boolean }>('/api/admin/role').then(r => setOwner(r.owner)).catch(() => {}); }, []);
  useEffect(() => {
    const on = () => setHash(hashId());
    window.addEventListener('popstate', on); window.addEventListener('hashchange', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); };
  }, []);
  // adres zawsze #id (stare #crates... przechodzą na pierwszą pozycję działu), ostatnia pozycja zapamiętana
  useEffect(() => {
    if (!onPanel || !item || item.kind !== 'panel') return;
    if (location.hash.slice(1) !== item.id) history.replaceState(null, '', `/admin#${item.id}`);
    try { localStorage.setItem(ITEM_KEY, item.id); } catch { /* brak */ }
  }, [onPanel, item]);
  useEffect(() => {
    if (!onPanel) return;
    const legacy = LEGACY_HASH[location.hash.slice(1)];
    const target = legacy ? ADMIN_GROUPS.flatMap(g => g.items).find(i => i.id === legacy) : undefined;
    if (target?.kind === 'page') location.replace(target.path!);
  }, [onPanel]);
  useEffect(() => { if (onPanel && item?.kind === 'panel') showSection(item.id); }, [onPanel, item]);
  useEffect(() => { window.scrollTo(0, 0); }, [activeId]);
  const activeGroup = ADMIN_GROUPS.find(g => g.items.some(i => i.id === activeId))?.id ?? '';
  useEffect(() => { setOpenG(activeGroup); }, [activeGroup]);
  useEffect(() => { if (root.current) return watchTables(root.current); }, []);
  useEffect(() => { if (root.current) return watchLists(root.current); }, []);

  const pick = useCallback<Pick>((e, i) => {
    setOpen(false);
    if (i.kind === 'panel' && onPanel && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      history.pushState(null, '', `/admin#${i.id}`);
      setHash(i.id);
    }
  }, [onPanel]);

  // pasek boczny nie przewija się: gdy pozycje się nie mieszczą, zostaje aktywna grupa i przycisk „Więcej”
  const fit = useCallback(() => {
    const n = nav.current;
    if (!n) return;
    n.dataset.compact = '0';
    if (n.scrollHeight > n.clientHeight + 1) {
      n.dataset.compact = '1';
      setMore(true);
    } else setMore(false);
  }, []);
  useLayoutEffect(() => { fit(); }, [fit, shown.length, activeId, owner, openG]);
  useEffect(() => {
    if (!nav.current) return;
    const ro = new ResizeObserver(fit);
    ro.observe(nav.current);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [fit]);

  const body = page(path);
  if (embed) return <div className="a-page a-embed">{body}</div>;   // podgląd karty w ramce okna edycji
  return (
    <div className={`a-page ${styles.page}`} ref={root}>
      <header className={styles.top}>
        <button type="button" className={styles.menuBtn} onClick={() => setOpen(true)} aria-haspopup="dialog"><Menu size={18} aria-hidden="true" /> Menu</button>
        <strong className={styles.topTitle}>{title}</strong>
        <a className={styles.topBack} href="/" aria-label="Wróć do gry"><ArrowLeft size={18} aria-hidden="true" /></a>
      </header>
      <div className={styles.shell}>
        <aside className={styles.side}>
          <a className={styles.logo} href="/"><Logo /></a>
          <a className={styles.back} href="/"><ArrowLeft size={16} aria-hidden="true" /> Wróć do gry</a>
          <label className={styles.search}><Search size={16} aria-hidden="true" /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj w panelu" aria-label="Szukaj w panelu" /></label>
          <nav className={styles.nav} ref={nav} aria-label="Panel admina"><MenuList items={shown} activeId={activeId} onPick={pick} compact={!needle} openGroup={openG} onToggle={g => setOpenG(o => o === g ? '' : g)} /></nav>
          {more && <button type="button" className={styles.more} onClick={() => setOpen(true)} aria-haspopup="dialog"><MoreHorizontal size={16} aria-hidden="true" /> Więcej</button>}
        </aside>
        <main className={styles.main}>
          <div className={styles.title}>
            <h1>{title}</h1>
            {item?.desc && <p>{item.desc}</p>}
          </div>
          {onPanel ? body : <div className={styles.pad}>{body}</div>}
        </main>
      </div>
      {open && <MenuDialog items={shown} activeId={activeId} q={q} setQ={setQ} onPick={pick} onClose={() => setOpen(false)} />}
    </div>
  );
}
