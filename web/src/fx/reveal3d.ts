// @ts-nocheck -- kod rysujący w DOM-ie; typy dochodzą przy dalszym porządkowaniu
// Wielkie odsłonięcie w 3D (Legendarna, Specjalna, ULTRA, Tajna): scena z revealScene.ts + karta w HTML nad nią.
// Przebieg: skrzynka spada, ładuje się (drżenie, światło ze szpary, wsysane iskry), wybucha, karta wylatuje z otworu,
// kręci się w powietrzu i ląduje na środku awersem. Kliknięcie albo Spacja/Enter/Esc przyspiesza, na końcu zamyka.
import { createRevealScene } from '../three/revealScene';
import type { CrateLook } from '../three/crateModel';
import { cardHTML } from '../cards/cardHtml';
import { baseVariant, isSpecial, person, variantName } from '../game/rules';
import { S } from '../game/store';
import { esc, fmt, sleep } from '../lib/format';
import { Sound } from '../sound/sound';
import { cardBackHTML, confetti, GOLDS, RAINBOW, SECRET_COLORS, SPECIAL_COLORS } from './effects';
import './css/reveal3d.css';

const TIERS = {
  gold: { colors: GOLDS, rings: 2, lidFly: false, levitate: 0, ambient: 'embers', charge: 1700, spins: 2, flight: 1150 },
  special: { colors: SPECIAL_COLORS, neon: true, rings: 3, lidFly: false, levitate: .35, ambient: 'neon', charge: 1900, spins: 3, flight: 1300 },
  ultra: { colors: RAINBOW, rainbow: true, rings: 4, lidFly: true, levitate: .8, ambient: 'spiral', charge: 2600, spins: 4, flight: 1500 },
  secret: { colors: SECRET_COLORS, dark: true, orbit: true, rings: 5, lidFly: true, levitate: .45, ambient: 'dust', charge: 4400, spins: 3, flight: 1900 }
};

export function epicReveal3d(drop, { fast = false, auto = false, look }: { fast?: boolean; auto?: boolean; look: CrateLook }) {
  return new Promise<void>((resolve, reject) => {
    const p = person(drop.person);
    const tierKey = p.rarity === 'secret' ? 'secret' : p.rarity === 'ultra' ? 'ultra' : p.rarity === 'special' ? 'special' : 'gold';
    const T = TIERS[tierKey];
    const R = S.cfg.rarities[p.rarity];
    const color = tierKey === 'secret' ? '#ffe3a0' : tierKey === 'special' ? T.colors[0] : R.color;
    const label = tierKey === 'secret' ? 'Tajna karta' : tierKey === 'special' && baseVariant(drop.variant) === 'joker' ? 'Joker' : R.name;
    const speed = fast ? .5 : 1;

    const el = document.createElement('div');
    el.className = `r3 r3-${tierKey}`;
    el.style.setProperty('--rc', color);
    el.innerHTML = `
      <canvas class="r3-canvas" aria-hidden="true"></canvas>
      <div class="r3-flash" aria-hidden="true"></div>
      <div class="r3-card"><div class="r3-spin">
        <div class="r3-face r3-back">${cardBackHTML()}</div>
        <div class="r3-face r3-front">${cardHTML(drop.person, drop.variant, drop.id)}</div>
      </div></div>
      <div class="r3-text" role="status">
        <div class="r3-label">${esc(label)}</div>
        <div class="r3-name">${esc(p.name)}</div>
        <div class="r3-meta">${isSpecial(drop.variant) ? `<span>${esc(variantName(drop.variant))}</span>` : ''}<b>${fmt(drop.value)}</b></div>
        <div class="r3-hint">Kliknij albo naciśnij spację</div>
      </div>`;
    document.body.appendChild(el);

    let scene;
    try { scene = createRevealScene(el.querySelector('.r3-canvas'), look, { ...T, color }); }
    catch (e) { el.remove(); reject(e); return; }

    const spin = el.querySelector('.r3-spin') as HTMLElement;
    let phase = 'intro', flight = null, chargeTimer = 0, autoTimer = 0;
    void el.offsetWidth;
    el.classList.add('on');

    // Tajna: po ładowaniu skrzynka wzlatuje i jaśnieje, dopiero potem wybucha
    function ascend() {
      if (phase !== 'charge') return;
      phase = 'ascend';
      clearTimeout(chargeTimer);
      const ms = 1600 * speed;
      scene.ascend(ms);
      el.classList.add('ascend');
      chargeTimer = setTimeout(burst, ms);
    }
    function burst() {
      if (phase !== 'intro' && phase !== 'charge' && phase !== 'ascend') return;
      phase = 'flying';
      clearTimeout(chargeTimer);
      scene.burst();
      el.classList.add('burst');
      Sound.boom(tierKey !== 'gold');
      if (tierKey === 'secret') Sound.choir(); else if (tierKey === 'ultra') Sound.ultra(true); else Sound.gold();
      if (tierKey !== 'gold') setTimeout(() => confetti(T.colors, tierKey === 'ultra' ? 220 : 140), 500 * speed);
      // Tajna: kamera wraca na wprost skrzynki w następnej klatce, dopiero wtedy wiadomo, gdzie jest otwór
      if (T.orbit) requestAnimationFrame(() => requestAnimationFrame(launch)); else launch();
    }
    function launch() {
      if (phase !== 'flying') return;
      // karta wylatuje z otworu skrzynki: z małej, odwróconej rewersem, przez kilka obrotów do awersu na środku
      const m = scene.mouth(), box = el.querySelector('.r3-card').getBoundingClientRect();
      const dx = m.x - (box.left + box.width / 2), dy = m.y - (box.top + box.height / 2), turns = T.spins * 360 + 180;
      el.classList.add('flying');
      flight = spin.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(.08) rotateY(0deg) rotateZ(-8deg)`, opacity: 0 },
        { transform: `translate(${dx * .4}px, ${dy * .2 - innerHeight * .2}px) scale(.7) rotateY(${turns * .55}deg) rotateZ(6deg)`, opacity: 1, offset: .45 },
        { transform: `translate(0, ${-innerHeight * .03}px) scale(1.07) rotateY(${turns - 20}deg) rotateZ(-2deg)`, opacity: 1, offset: .78 },
        { transform: `translate(0, 0) scale(1) rotateY(${turns}deg) rotateZ(0deg)`, opacity: 1 }
      ], { duration: T.flight * speed, easing: 'cubic-bezier(.2, .7, .25, 1)', fill: 'forwards' });
      flight.onfinish = ready;
    }
    function ready() {
      if (phase === 'ready' || phase === 'closing') return;
      phase = 'ready';
      flight?.finish();
      // kliknięcie, zanim karta zdążyła wylecieć: od razu awersem na środku
      if (!flight) { spin.style.opacity = '1'; spin.style.transform = `rotateY(${T.spins * 360 + 180}deg)`; }
      el.classList.add('ready');
      if (auto) autoTimer = setTimeout(close, fast ? 900 : 1600);
    }
    function close() {
      if (phase === 'closing') return;
      phase = 'closing';
      clearTimeout(chargeTimer); clearTimeout(autoTimer);
      window.removeEventListener('keydown', onKey, true);
      el.classList.add('closing');
      setTimeout(() => { scene.destroy(); el.remove(); resolve(); }, 380);
    }
    function advance() {
      if (phase === 'charge' && T.orbit) ascend();
      else if (phase === 'intro' || phase === 'charge' || phase === 'ascend') burst();
      else if (phase === 'flying') ready();
      else if (phase === 'ready') close();
    }
    function onKey(e) {
      if ([' ', 'Enter', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); advance(); }
    }
    window.addEventListener('keydown', onKey, true);
    el.addEventListener('click', advance);

    (async () => {
      await scene.intro(fast);
      if (phase !== 'intro') return;
      Sound.land('green');   // zwykłe stuknięcie: rzadkość zdradza dopiero kolor światła
      await sleep(180 * speed);
      if (phase !== 'intro') return;
      phase = 'charge';
      const ms = T.charge * speed;
      scene.charge(ms);
      el.classList.add('charging');
      if (tierKey === 'secret') Sound.drone(ms + 1600 * speed); else Sound.charge(ms / 1000, tierKey === 'ultra');
      chargeTimer = setTimeout(T.orbit ? ascend : burst, ms);
    })();
  });
}
