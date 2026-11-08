import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Gift, MoreHorizontal, X } from 'lucide-react';

import { api } from '../api/client';
import { S, useGame } from '../game/store';
import { Avatar } from '../ui/UserLink';
import { Money } from '../ui/Money';
import { Ambient } from './Ambient';
import { InstallButton } from './InstallButton';
import { SettingsPanel, SoundControl } from './Settings';
import { LEGAL_NAV, navFor, titleFor, type NavItem } from './nav';
import { Logo } from './Logo';
import styles from './AppShell.module.css';

const logout = async () => { try { await api('/api/logout', {}); } catch { /* i tak wracamy do logowania */ } location.href = '/login'; };

/** Jedna pozycja nawigacji: trasa Reacta, pełny link (panel admina) albo akcja (wyloguj). `tile` = kafelek w arkuszu */
function NavEntry({ item, onPick, tile }: { item: NavItem; onPick?: () => void; tile?: boolean }) {
  const navigate = useNavigate();
  const count = item.badge ? S.badges[item.badge] : 0;
  // wyjście z ekranu może zatrzymać okienko (kasyno po przegranej)
  const leave = (e: MouseEvent, go: () => void) => { if (S.leaveGuard?.(go)) e.preventDefault(); };
  const cls = tile ? styles.tile : styles.link;
  const inner = (
    <>
      <item.icon size={tile ? 22 : 17} strokeWidth={1.6} aria-hidden="true" />
      <span>{item.label}</span>
      {count > 0 && <span className={styles.badge} aria-label={`${count} nowych`}>{count}</span>}
    </>
  );
  if (item.action === 'logout') return <button className={cls} type="button" onClick={() => { onPick?.(); void logout(); }}>{inner}</button>;
  if (item.href) return <a className={cls} href={item.href}>{inner}</a>;
  return (
    <NavLink to={item.path!} end={item.path === '/'} onClick={e => { leave(e, () => navigate(item.path!)); onPick?.(); }}
      className={({ isActive }) => `${cls}${isActive ? ` ${styles.on}` : ''}`}>
      {inner}
    </NavLink>
  );
}

function LegalLinks({ className, onPick }: { className: string; onPick?: () => void }) {
  return (
    <nav className={className} aria-label="Informacje prawne">
      {LEGAL_NAV.map(l => <Link key={l.path} to={l.path} onClick={onPick}>{l.label}</Link>)}
    </nav>
  );
}

function MyAvatar() {
  const { me } = useGame();
  return me ? <Avatar user={me} size={32} /> : null;
}

// rola właściciela (kopie zapasowe) sprawdzana raz na sesję; serwer i tak pilnuje dostępu
let ownerKnown: boolean | undefined;
function useOwner(isAdmin: boolean) {
  const [owner, setOwner] = useState(ownerKnown ?? false);
  useEffect(() => {
    if (!isAdmin || ownerKnown !== undefined) return;
    api<{ owner: boolean }>('/api/admin/role').then(r => { ownerKnown = r.owner; setOwner(r.owner); }).catch(() => {});
  }, [isAdmin]);
  return isAdmin && owner;
}

/** wysokość pozycji paska bocznego i odstęp między nimi (px) - muszą się zgadzać z `.link` / `.nav` w AppShell.module.css */
const SIDE_ROW = 38;
const SIDE_GAP = 2;

const FOCUSABLE ='a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Arkusz „Więcej” (dolny pasek na telefonie, pasek boczny na komputerze): wszystkie ekrany, konto, ustawienia i strony prawne */
function MoreSheet({ items, account, onClose }: { items: NavItem[]; account: NavItem[]; onClose: () => void }) {
  const game = useGame();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; opener?.focus?.(); };
  }, []);

  const key = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); return onClose(); }
    if (e.key !== 'Tab') return;
    const f = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className={styles.sheetBack} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={key}>
      <div className={styles.sheet} ref={box} role="dialog" aria-modal="true" aria-label="Menu">
        <div className={styles.grab} aria-hidden="true" />
        <header className={styles.sheetHead}>
          <b>Menu</b>
          <button ref={close} className={styles.icon} type="button" aria-label="Zamknij" onClick={onClose}><X size={22} strokeWidth={1.6} /></button>
        </header>
        <nav className={styles.tiles} aria-label="Wszystkie ekrany">
          {items.map(i => <NavEntry key={i.id} item={i} tile onPick={onClose} />)}
        </nav>
        <nav className={styles.tiles} aria-label="Konto">
          {account.map(i => <NavEntry key={i.id} item={i} tile onPick={onClose} />)}
        </nav>
        <button className={styles.daily} type="button" onClick={() => { onClose(); S.openDaily?.(); }}>
          <Gift size={17} strokeWidth={1.6} aria-hidden="true" />Codzienna skrzynka
          {game.dailyClaimable && <i className={styles.ready} aria-label="do odebrania" />}
        </button>
        <section className={styles.sheetSettings} aria-label="Ustawienia">
          <h2>Ustawienia</h2>
          <SettingsPanel />
        </section>
        <div className={styles.foot}><InstallButton className={styles.icon} /></div>
        <LegalLinks className={styles.legal} onPick={onClose} />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const game = useGame();
  const [sheet, setSheet] = useState(false);
  const { pathname } = useLocation();
  const owner = useOwner(!!game.me?.isAdmin);
  const { game: items, account, primary } = navFor({ arena: !!game.cfg.arena, admin: !!game.me?.isAdmin, owner, username: game.me?.username ?? '' });
  const title = titleFor(pathname);
  const moreCount = items.filter(i => !i.primary).reduce((n, i) => n + (i.badge ? S.badges[i.badge] : 0), 0);

  useEffect(() => { setSheet(false); }, [pathname]);

  // Pasek boczny się nie przewija: pokazuje tyle pozycji, ile mieści się w wysokości okna, a resztę
  // (od końca listy) zjada „Więcej” - arkusz ma zawsze pełną listę. Wysokość `.nav` nie zależy od liczby
  // pozycji (flex: 1, min-height: 0), więc wystarczy ją podzielić przez wysokość jednej pozycji.
  const sideItems = [...items, ...account.filter(i => i.href || i.id === 'settings')];
  const navRef = useRef<HTMLElement>(null);
  const [fit, setFit] = useState(sideItems.length);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      if (!nav.clientHeight) return; // pasek ukryty (telefon)
      const row = SIDE_ROW + SIDE_GAP;
      setFit(Math.max(0, Math.floor((nav.clientHeight + SIDE_GAP) / row) - 1)); // -1: miejsce na „Więcej”
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);
  const hiddenCount = sideItems.slice(fit).reduce((n, i) => n + (i.badge ? S.badges[i.badge] : 0), 0);

  return (
    <div className={styles.app}>
      <Ambient />
      <aside className={styles.side}>
        <a className={styles.brand} href="/"><Logo />ScamBox</a>
        <nav className={styles.nav} aria-label="Główna" ref={navRef}>
          {sideItems.slice(0, fit).map(i => <NavEntry key={i.id} item={i} />)}
          <button className={styles.link} type="button" aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)}>
            <MoreHorizontal size={17} strokeWidth={1.6} aria-hidden="true" />
            <span>Więcej</span>
            {hiddenCount > 0 && <span className={styles.badge} aria-label={`${hiddenCount} nowych`}>{hiddenCount}</span>}
          </button>
        </nav>
        <div className={styles.foot}>
          <Link className={styles.user} to={`/player/${encodeURIComponent(game.me?.username ?? '')}`}><MyAvatar /><span>{game.me?.username}</span></Link>
          <InstallButton className={styles.icon} />
          <SoundControl className={styles.icon} />
        </div>
        <LegalLinks className={styles.legal} />
      </aside>

      <header className={styles.phoneTop}>
        <a className={styles.brand} href="/"><Logo />ScamBox</a>
        <span className={styles.phoneMoney}><Money value={game.state.balance} /></span>
        <button className={`${styles.icon} ${styles.phoneGift}`} type="button" aria-label="Codzienna skrzynka" onClick={() => S.openDaily?.()}>
          <Gift size={20} strokeWidth={1.6} />
          {game.dailyClaimable && <i className={styles.ready} aria-label="do odebrania" />}
        </button>
      </header>

      <main className={styles.main}>
        <div className={styles.top}>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.topRight}>
            <span className={styles.money}><Money value={game.state.balance} /></span>
            <button className={styles.daily} type="button" onClick={() => S.openDaily?.()}>
              <Gift size={17} strokeWidth={1.6} aria-hidden="true" />Codzienna skrzynka
              {game.dailyClaimable && <i className={styles.ready} aria-label="do odebrania" />}
            </button>
          </div>
        </div>
        {children}
      </main>

      <nav className={styles.tabbar} aria-label="Skróty">
        {primary.map(i => <NavEntry key={i.id} item={i} />)}
        <button className={styles.link} type="button" aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)}>
          <MoreHorizontal size={17} strokeWidth={1.6} aria-hidden="true" />
          <span>Więcej</span>
          {moreCount > 0 && <span className={styles.badge} aria-label={`${moreCount} nowych`}>{moreCount}</span>}
        </button>
      </nav>

      {sheet && <MoreSheet items={items} account={account} onClose={() => setSheet(false)} />}
    </div>
  );
}
