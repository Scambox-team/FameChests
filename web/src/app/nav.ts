import { Backpack, BookOpen, Database, Dices, Gamepad2, Hammer, House, LogOut, Package, Settings, ShieldCheck, Store, Swords, Trophy, User, Users, type LucideIcon } from 'lucide-react';

/** Co widać w nawigacji: wszystkie pozycje (pasek boczny na komputerze, arkusz „Więcej” na telefonie)
 *  pochodzą z jednej listy, żeby komputer i telefon miały te same funkcje. */
export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** adres trasy Reacta (NavLink) */
  path?: string;
  /** pełne przeładowanie strony (panel admina to osobna aplikacja) */
  href?: string;
  /** akcja zamiast adresu (np. wyloguj) */
  action?: 'logout';
  badge?: 'market' | 'casino' | 'friends';
  /** w dolnym pasku na telefonie (reszta jest pod „Więcej”) */
  primary?: boolean;
  /** kto widzi: domyślnie każdy zalogowany */
  only?: 'arena' | 'admin' | 'owner';
}

export const GAME_NAV: NavItem[] = [
  { id: 'home', path: '/', label: 'Start', icon: House, primary: true },
  { id: 'crates', path: '/crates', label: 'Skrzynki', icon: Package, primary: true },
  { id: 'binder', path: '/binder', label: 'Klaser', icon: BookOpen },
  { id: 'inventory', path: '/inventory', label: 'Ekwipunek', icon: Backpack, primary: true },
  { id: 'forge', path: '/forge', label: 'Kuźnia', icon: Hammer },
  { id: 'market', path: '/market', label: 'Rynek', icon: Store, badge: 'market', primary: true },
  { id: 'casino', path: '/casino', label: 'Kasyno', icon: Dices, badge: 'casino' },
  { id: 'friends', path: '/friends', label: 'Znajomi', icon: Users, badge: 'friends' },
  { id: 'ranking', path: '/ranking', label: 'Ranking', icon: Trophy },
  { id: 'games', path: '/games', label: 'Gry', icon: Gamepad2 },
  { id: 'arena', path: '/arena', label: 'Arena', icon: Swords, only: 'arena' }
];

/** Konto i administracja; profil gracza dostaje adres dopiero z nazwy użytkownika */
export const ACCOUNT_NAV: NavItem[] = [
  { id: 'profile', path: '/player/', label: 'Mój profil', icon: User },
  { id: 'settings', path: '/ustawienia', label: 'Ustawienia', icon: Settings },
  { id: 'admin', href: '/admin', label: 'Panel admina', icon: ShieldCheck, only: 'admin' },
  { id: 'backups', href: '/admin/backups', label: 'Kopie zapasowe', icon: Database, only: 'owner' },
  { id: 'logout', action: 'logout', label: 'Wyloguj', icon: LogOut }
];

export const LEGAL_NAV: { path: string; label: string }[] = [
  { path: '/regulamin', label: 'Regulamin' },
  { path: '/prywatnosc', label: 'Prywatność' },
  { path: '/o-stronie', label: 'O stronie' },
  { path: '/zglos', label: 'Zgłoś problem' }
];

export interface NavContext { arena: boolean; admin: boolean; owner: boolean; username: string }

const visible = (i: NavItem, c: NavContext) =>
  !i.only || (i.only === 'arena' && c.arena) || (i.only === 'admin' && c.admin) || (i.only === 'owner' && c.owner);

/** Pozycje dla danego gracza; profil dostaje adres `/player/<nazwa>` */
export function navFor(c: NavContext) {
  const game = GAME_NAV.filter(i => visible(i, c));
  const account = ACCOUNT_NAV.filter(i => visible(i, c)).map(i => i.id === 'profile' ? { ...i, path: `/player/${encodeURIComponent(c.username)}` } : i);
  return { game, account, primary: game.filter(i => i.primary) };
}

/** Tytuł ekranu dla adresu */
export function titleFor(pathname: string) {
  if (pathname.startsWith('/player/')) return 'Profil';
  if (pathname.startsWith('/ustawienia')) return 'Ustawienia';
  return GAME_NAV.find(i => i.path === '/' ? pathname === '/' : pathname.startsWith(i.path!))?.label ?? 'ScamBox';
}
