// Kształt odpowiedzi serwera. Klucze i nazwy pól pochodzą z API i się nie zmieniają.

export interface Rarity { name: string; color: string; value: number; [key: string]: any }
export interface CardType { name: string; icon: string; weak: string; resist: string }

export interface Person {
  id: string;
  name: string;
  rarity: string;
  type: string;
  crate: string;
  crates?: string[];
  number: number;
  hp: number;
  masked?: boolean;
  country?: string;
  subtitle?: string;
  desc?: string;
  imgv?: number;
  [key: string]: any;
}

export interface Crate {
  id: string;
  name: string;
  short: string;
  code: string;
  desc: string;
  emoji: string;
  price: number;
  color1: string;
  color2: string;
  shop: boolean;
  canBuy: boolean;
  restricted?: boolean;
  released?: boolean;
  special?: boolean;
  people: string[];
  weights: Record<string, number>;
  variants?: string[];
  [key: string]: any;
}

export interface Variant {
  name: string;
  chance: number;
  mult: number;
  combo?: boolean;
  layers?: string[];
  [key: string]: any;
}

export interface Config {
  rarities: Record<string, Rarity>;
  rarityOrder: string[];
  types: Record<string, CardType>;
  people: Record<string, Person>;
  crates: Record<string, Crate>;
  crateOrder: string[];
  variants: Record<string, Variant>;
  variantOrder: string[];
  [key: string]: any;
}

export interface Item {
  id: number;
  person: string;
  variant: string;
  value: number;
  fav: boolean;
  created: number;
  [key: string]: any;
}

export interface GameState {
  balance: number;
  opened: number;
  spent: number;
  earned: number;
  [key: string]: any;
}

export interface User {
  id: number;
  username: string;
  avatar: string;
  avatarCard: string | null;
  avatarRarity: string | null;
  avatarVariant: string | null;
  isAdmin: boolean;
}

export interface StateResponse {
  state: GameState;
  items: Item[];
  showcase?: number[];
  drawn?: number[];
  scratched?: number[];
  chests?: Record<string, number>;
  collected?: [string, string][];
}
