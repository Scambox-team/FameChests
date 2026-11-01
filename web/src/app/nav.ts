import { Backpack, BookOpen, Dices, Gamepad2, Hammer, Package, Store, Swords, Trophy, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  badge?: 'market' | 'casino' | 'friends';
  admin?: boolean;
  short?: boolean;   // w dolnym pasku na telefonie
}

export const NAV: NavItem[] = [
  { path: '/crates', label: 'Skrzynki', icon: Package, short: true },
  { path: '/binder', label: 'Klaser', icon: BookOpen, short: true },
  { path: '/inventory', label: 'Ekwipunek', icon: Backpack, short: true },
  { path: '/forge', label: 'Kuźnia', icon: Hammer },
  { path: '/market', label: 'Rynek', icon: Store, badge: 'market', short: true },
  { path: '/casino', label: 'Kasyno', icon: Dices, badge: 'casino' },
  { path: '/friends', label: 'Znajomi', icon: Users, badge: 'friends' },
  { path: '/ranking', label: 'Ranking', icon: Trophy },
  { path: '/games', label: 'Gry', icon: Gamepad2 },
  { path: '/arena', label: 'Arena', icon: Swords, admin: true }
];

// Adresy przeniesione już na Reacta (ta sama lista jest w server/src/routes/pages.rs).
// Link do pozostałych przeładowuje stronę, bo obsługuje je stara wersja gry.
export const REACT_PATHS = ['/', '/crates', '/inventory', '/inventory/hall-of-fame', '/binder', '/forge', '/market', '/casino', '/friends', '/ranking', '/games', '/arena', '/inventory/figures', '/admin', '/admin/chess', '/stickers', '/variants', '/designer', '/mockups'];
export const isReactPath = (path: string) => REACT_PATHS.includes(path) || path === '/player' || path.startsWith('/player/');
