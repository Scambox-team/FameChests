import { useState, type MouseEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Gift, Menu, Settings, X } from 'lucide-react';

import { S, useGame } from '../game/store';
import { Avatar } from '../ui/UserLink';
import { Money } from '../ui/Money';
import { Ambient } from './Ambient';
import { InstallButton } from './InstallButton';
import { SoundControl } from './Settings';
import { NAV, type NavItem } from './nav';
import { Logo } from './Logo';
import styles from './AppShell.module.css';

function NavEntry({ item, onPick }: { item: NavItem; onPick?: () => void }) {
  const navigate = useNavigate();
  const count = item.badge ? S.badges[item.badge] : 0;
  // wyjście z ekranu może zatrzymać okienko (kasyno po przegranej)
  const leave = (e: MouseEvent, go: () => void) => { if (S.leaveGuard?.(go)) e.preventDefault(); };
  const inner = (
    <>
      <item.icon size={17} strokeWidth={1.6} aria-hidden="true" />
      <span>{item.label}</span>
      {count > 0 && <span className={styles.badge} aria-label={`${count} nowych`}>{count}</span>}
    </>
  );
  // adresy ze starej wersji gry muszą przeładować stronę
  return (
    <NavLink to={item.path} end={item.path === '/'} onClick={e => { leave(e, () => navigate(item.path)); onPick?.(); }} className={({ isActive }) => `${styles.link}${isActive ? ` ${styles.on}` : ''}`}>
      {inner}
    </NavLink>
  );
}

function LegalLinks({ className, onPick }: { className: string; onPick?: () => void }) {
  return (
    <nav className={className} aria-label="Informacje prawne">
      <Link to="/regulamin" onClick={onPick}>Regulamin</Link>
      <Link to="/prywatnosc" onClick={onPick}>Prywatność</Link>
      <Link to="/o-stronie" onClick={onPick}>O stronie</Link>
      <Link to="/zglos" onClick={onPick}>Zgłoś problem</Link>
    </nav>
  );
}

function MyAvatar() {
  const { me } = useGame();
  return me ? <Avatar user={me} size={32} /> : null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const game = useGame();
  const [sheet, setSheet] = useState(false);
  const { pathname } = useLocation();
  const items = NAV.filter(i => !i.admin || game.cfg.arena);
  const title = pathname.startsWith('/player/') ? 'Profil' : NAV.find(i => i.path === '/' ? pathname === '/' : pathname.startsWith(i.path))?.label ?? 'ScamBox';

  return (
    <div className={styles.app}>
      <Ambient />
      <aside className={styles.side}>
        <a className={styles.brand} href="/"><Logo />ScamBox</a>
        <nav className={styles.nav} aria-label="Główna">
          {items.map(i => <NavEntry key={i.path} item={i} />)}
          {game.me?.isAdmin && <a className={styles.link} href="/admin"><Settings size={17} strokeWidth={1.6} aria-hidden="true" /><span>Panel admina</span></a>}
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
        <button className={styles.icon} type="button" aria-label="Menu" onClick={() => setSheet(true)}><Menu size={20} strokeWidth={1.6} /></button>
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
        {items.filter(i => i.short).map(i => <NavEntry key={i.path} item={i} />)}
      </nav>

      {sheet && (
        <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Menu">
          <button className={`${styles.icon} ${styles.sheetClose}`} type="button" aria-label="Zamknij" onClick={() => setSheet(false)}><X size={22} strokeWidth={1.6} /></button>
          <nav className={styles.sheetNav}>
            {items.map(i => <NavEntry key={i.path} item={i} onPick={() => setSheet(false)} />)}
          </nav>
          <div className={styles.foot}>
            <button className={styles.daily} type="button" onClick={() => { setSheet(false); S.openDaily?.(); }}><Gift size={17} strokeWidth={1.6} aria-hidden="true" />Codzienna skrzynka</button>
            <SoundControl className={styles.icon} />
          </div>
          <LegalLinks className={styles.legal} onPick={() => setSheet(false)} />
        </div>
      )}
    </div>
  );
}
