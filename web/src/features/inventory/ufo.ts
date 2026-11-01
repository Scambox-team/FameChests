// Easter egg: wizyta UFO. Karta pojawia się na górze ekwipunku, a kliknięta zostaje wciągnięta przez spodek.
import { api } from '../../api/client';
import { person } from '../../game/rules';
import { S, touch } from '../../game/store';
import { Sound } from '../../sound/sound';
import '../../cards/css/ufo.css';

export function noteUfo(me: any) { if (me?.ufo && !S.ufo && person(me.ufo)) { S.ufo = { pid: me.ufo, shown: false }; touch(); } }
export function ufoArrive() {
  if (!S.ufo || S.ufo.shown) return;
  S.ufo.shown = true;
  api('/api/ufo/seen', {}).catch(() => {});
  touch();
}
export function ufoLeave() { if (!S.ufo?.abducting) S.ufo = null; }

const lights = [22, 46, 72, 98, 124, 148].map(x => `<circle class="ul" cx="${x}" cy="${(55 - Math.abs(85 - x) / 12).toFixed(1)}" r="4.5" fill="#fff6a8"/>`).join('');
const SHIP = `<svg viewBox="0 0 170 90" aria-hidden="true">
  <defs><radialGradient id="ufDome" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#f2fdff"/><stop offset=".55" stop-color="#9fe6f5" stop-opacity=".85"/><stop offset="1" stop-color="#3f8fa6" stop-opacity=".9"/></radialGradient>
  <linearGradient id="ufHull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e6ea"/><stop offset=".45" stop-color="#9aa0a7"/><stop offset="1" stop-color="#4b5056"/></linearGradient></defs>
  <ellipse cx="85" cy="70" rx="34" ry="9" fill="#b9f3ff" opacity=".55"/>
  <path d="M52 44 Q55 12 85 10 Q115 12 118 44 Z" fill="url(#ufDome)" stroke="#5b6a70" stroke-width="1.5"/>
  <ellipse cx="85" cy="52" rx="82" ry="20" fill="url(#ufHull)" stroke="#33373c" stroke-width="2"/>
  <ellipse cx="85" cy="46" rx="60" ry="8" fill="none" stroke="#ffffff70" stroke-width="2"/>
  ${lights}
</svg>`;

export async function ufoAbduct(item: HTMLElement) {
  if (!S.ufo || S.ufo.abducting) return;
  S.ufo.abducting = true;
  const card = item.querySelector('.card')!, r = card.getBoundingClientRect();
  const scene = document.createElement('div');
  scene.className = 'ufo-scene';
  const cx = r.left + r.width / 2, hoverY = Math.max(70, r.top - 70), fromLeft = cx > innerWidth / 2;
  scene.innerHTML = `<div class="ufo-beam"></div><div class="ufo-card">${card.outerHTML}</div><div class="ufo-ship">${SHIP}</div>`;
  document.body.appendChild(scene);
  const [beam, ghost, ship] = [...scene.children] as HTMLElement[];
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
  Object.assign(beam.style, { left: `${cx}px`, top: `${hoverY}px`, height: `${Math.max(40, r.bottom - hoverY)}px` });
  item.classList.add('gone');
  const at = (x: number, y: number, extra = '') => `translate(${x}px, ${y}px) ${extra}`;
  const startX = fromLeft ? -160 : innerWidth + 160;
  try {
    Sound.ufoArrive();
    await ship.animate([
      { transform: at(startX, -120, 'rotate(-14deg) scale(.6)') },
      { transform: at((startX + cx) / 2, hoverY - 60, 'rotate(8deg) scale(.85)'), offset: .6 },
      { transform: at(cx, hoverY + 8, 'rotate(-4deg)'), offset: .85 },
      { transform: at(cx, hoverY, 'rotate(0deg)') }
    ], { duration: 1500, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' }).finished;
    const bob = ship.animate([{ transform: at(cx, hoverY) }, { transform: at(cx, hoverY - 5, 'rotate(1.5deg)') }, { transform: at(cx, hoverY) }], { duration: 900, iterations: Infinity, easing: 'ease-in-out' });
    Sound.ufoBeam();
    await beam.animate([{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 1, transform: 'scaleY(1)' }], { duration: 350, easing: 'ease-out', fill: 'forwards' }).finished;
    const dy = hoverY + 10 - (r.top + r.height / 2);
    await ghost.animate([
      { transform: 'none', filter: 'brightness(1)' },
      { transform: 'translateX(-3px) rotate(-1deg)', offset: .06 }, { transform: 'translateX(3px) rotate(1deg)', offset: .12 },
      { transform: 'translateX(-2px)', offset: .18 }, { transform: 'translateY(-6px)', filter: 'brightness(1.4)', offset: .26 },
      { transform: `translateY(${dy * .55}px) rotate(200deg) scale(.55)`, filter: 'brightness(1.8)', offset: .7 },
      { transform: `translateY(${dy}px) rotate(420deg) scale(.04)`, filter: 'brightness(3)', opacity: .6 }
    ], { duration: 1900, easing: 'cubic-bezier(.5,0,.7,1)', fill: 'forwards' }).finished;
    ghost.remove();
    await beam.animate([{ opacity: 1, transform: 'scaleY(1)' }, { opacity: 0, transform: 'scaleY(0)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' }).finished;
    bob.cancel();
    Sound.ufoLeave();
    await ship.animate([
      { transform: at(cx, hoverY) },
      { transform: at(cx + (fromLeft ? -20 : 20), hoverY + 10, 'rotate(-6deg)'), offset: .2 },
      { transform: at(fromLeft ? innerWidth + 200 : -200, -200, `rotate(${fromLeft ? 18 : -18}deg) scale(.3)`) }
    ], { duration: 1000, easing: 'cubic-bezier(.6,0,.9,.4)', fill: 'forwards' }).finished;
  } finally {
    scene.remove();
    S.ufo = null;
    touch();
  }
}
