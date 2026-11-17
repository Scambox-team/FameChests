// Okienko „Nowy level”: wylatuje obok osiągnięć (kontener #achToasts), kilka leveli naraz układa się jedno pod drugim.
import { esc } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { S } from '../../game/store';
import { serviceBadgeSvg } from './badge';
import './levelup.css';

export interface Reward { text: string }
export interface LevelUp { level: number; paid: boolean; badge: boolean; choice?: boolean; small: Reward[]; special: Reward[]; /** zbiorcze okienko: od którego levelu i ile leveli naraz */ from?: number; count?: number }

const SHOW_MS = 7000;
let showing = 0;
const queue: LevelUp[] = [];

/** Wiele leveli naraz (np. stare konto po ręcznym nadaniu EXP) to jedno okienko, nie kilkadziesiąt po kolei */
export function showLevelUps(list: LevelUp[]) {
  if (list.length > 3) {
    const last = list[list.length - 1];
    queue.push({ level: last.level, from: list[0].level, count: list.length, paid: list.some(l => l.paid), badge: list.some(l => l.badge), choice: list.some(l => l.choice), small: [], special: [] });
  } else queue.push(...list);
  pump();
}

function pump() {
  while (queue.length && showing < 3) popup(queue.shift()!);
}

function popup(l: LevelUp) {
  let host = document.getElementById('achToasts');
  if (!host) { host = document.createElement('div'); host.id = 'achToasts'; document.body.appendChild(host); }
  const year = S.exp?.badge?.year ?? new Date().getFullYear();
  const tier = S.exp?.badge?.tier ?? 1;
  const rewards = [...l.small, ...l.special].map(r => esc(r.text));
  const el = document.createElement('div');
  el.className = `lvl-popup${l.badge ? ' lvl-max' : ''}`;
  const many = l.count ? `<span>Nagrody za ${l.count} leveli zostały dodane do konta</span>` : '';
  el.innerHTML = `<div class="lvl-num">${l.badge ? serviceBadgeSvg(year, tier) : `<small>LEVEL</small><b>${l.level}</b>`}</div>
<div class="lvl-txt"><small>${l.badge ? 'Maksymalny level' : l.count ? 'Nowe levele' : 'Nowy level'}</small><b>${l.badge ? `Odznaka za służbę w roku ${year}${S.exp?.badge ? ` (${S.exp.badge.name})` : ''}` : l.count ? `Levele ${l.from}-${l.level}` : `Level ${l.level}`}</b>${many ||
    (rewards.length ? `<span>${rewards.join(' · ')}</span>` : l.paid ? '' : '<span>Zaliczony bez nagrody</span>')}${l.special.length ? '<em>Nagroda specjalna</em>' : ''}${l.choice ? '<em>Duża nagroda: wybierz 2 z 4</em>' : ''}${l.badge ? '<span>Level wraca do 1 - zaczynasz od nowa</span>' : ''}</div>`;
  host.appendChild(el);
  showing++;
  try { Sound.reveal('gold'); } catch { /* bez dźwięku */ }
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  const close = () => {
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => { el.remove(); showing--; pump(); }, 500);
  };
  setTimeout(close, SHOW_MS);
  el.addEventListener('click', close);
}
