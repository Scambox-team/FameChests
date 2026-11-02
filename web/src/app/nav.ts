import { Backpack, BookOpen, Dices, Gamepad2, Hammer, House, Package, Store, Swords, Trophy, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  badge?: 'market' | 'casino' | 'friends';
  admin?: boolean;
  short?: boolean;   // w dolnym pasku na telefonie
}

export const NAV: NavItem[] = [
  { path: '/', label: 'Start', icon: House, short: true },
  { path: '/crates', label: 'Skrzynki', icon: Package, short: true },
  { path: '/binder', label: 'Klaser', icon: BookOpen },
  { path: '/inventory', label: 'Ekwipunek', icon: Backpack, short: true },
  { path: '/forge', label: 'Kuźnia', icon: Hammer },
  { path: '/market', label: 'Rynek', icon: Store, badge: 'market', short: true },
  { path: '/casino', label: 'Kasyno', icon: Dices, badge: 'casino' },
  { path: '/friends', label: 'Znajomi', icon: Users, badge: 'friends' },
  { path: '/ranking', label: 'Ranking', icon: Trophy },
  { path: '/games', label: 'Gry', icon: Gamepad2 },
  { path: '/arena', label: 'Arena', icon: Swords, admin: true }
];

