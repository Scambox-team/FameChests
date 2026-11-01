import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Banknote, Bomb, Bot, Circle, Cherry, CircleDollarSign, Coins, CornerDownLeft, Dumbbell, Droplets, Flame, Gift, Handshake, Hand, Heart, HeartPulse, Megaphone, Mic,
  MoveHorizontal, Music, Music2, Plus, Repeat, Shield, Skull, Snowflake, Sparkles, Star, Swords, TrendingDown, Trophy, Volleyball, Zap, type LucideIcon
} from 'lucide-react';

// Ikony na planszy Areny są częścią gotowego HTML, więc trzymamy je jako napisy
const svg = (Icon: LucideIcon, color?: string) => `<span class="ar-ic"${color ? ` style="color:${color}"` : ''}>${renderToStaticMarkup(createElement(Icon, { size: '1em', 'aria-hidden': true }))}</span>`;

export const IC = {
  coin: svg(Coins, '#e5b94a'), heart: svg(Heart, '#e5484d'), bolt: svg(Zap, '#e5b94a'), shield: svg(Shield), gift: svg(Gift), star: svg(Star, '#e5b94a'),
  bot: svg(Bot), back: svg(CornerDownLeft), trophy: svg(Trophy, '#e5b94a'), draw: svg(Handshake), skull: svg(Skull),
  tomato: svg(Cherry, '#e5484d'), ball: svg(Volleyball, '#fff'), boom: svg(Bomb, '#ff9f1a'), money: svg(Banknote, '#3fc07a'),
  note: svg(Music, '#fff'), notes: svg(Music2, '#fff'), mic: svg(Mic, '#fff'), heartFx: svg(Heart, '#ff5c9a')
};

const EFFECTS: Record<string, string> = {
  burn: svg(Flame, '#ff7a1a'), poison: svg(Skull, '#7bd148'), stun: svg(Sparkles, '#e5b94a'), shield: IC.shield, heal: svg(HeartPulse, '#3fc07a'), taunt: svg(Megaphone),
  boost: svg(Dumbbell), weaken: svg(TrendingDown), lifesteal: svg(Droplets, '#e5484d'), splash: svg(Swords), steal_coins: svg(CircleDollarSign, '#e5b94a'),
  extra_action: svg(Plus), knockback: svg(MoveHorizontal)
};
const VISUALS: Record<string, string> = {
  hit: svg(Hand), tomato: IC.tomato, lightning: IC.bolt, explosion: IC.boom, money: IC.money, mic: IC.mic, ball: IC.ball,
  fire: svg(Flame, '#ff7a1a'), ice: svg(Snowflake, '#9fdcff'), hearts: IC.heartFx, bubble: svg(Circle, '#9fdcff')
};

export const effectIcon = (id: string) => EFFECTS[id] ?? svg(Repeat);
export const visualIcon = (id: string) => VISUALS[id] ?? VISUALS.hit;
