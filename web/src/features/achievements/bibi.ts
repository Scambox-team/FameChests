// Easter egg: obrazek przy kartach oznaczonych w panelu admina (nagłówek X-Bibi).
// Pokazujemy go dopiero, gdy gracz widzi kartę: przy skrzynkach po odsłonięciu, a przy reszcie źródeł gdy nie ma już
// odsłonięcia ani otwierania skrzynki (najwyżej po 60 s odpada).
import { epicOpen } from '../../fx/effects';
import { S } from '../../game/store';
import './bibi.css';

let pending = 0, timer: ReturnType<typeof setInterval> | 0 = 0;

export function bibiQueue() {
  pending = Date.now();
  if (timer) return;
  timer = setInterval(() => {
    if (!pending || Date.now() - pending > 60000) { pending = 0; clearInterval(timer as any); timer = 0; return; }
    if (!S.opening && !epicOpen() && Date.now() - pending > 2500) bibiPlay();
  }, 400);
}

export function bibiPlay() {
  if (!pending) return;
  pending = 0;
  if (document.querySelector('.bibi-wrap')) return;
  const wrap = document.createElement('div');
  wrap.className = 'bibi-wrap';
  const stars = Array.from({ length: 140 }, (_, i) => {
    const wave = i % 3, dx = (Math.random() - .4) * 1400, dy = (Math.random() - .5) * 1000, sz = 14 + Math.random() * (wave === 2 ? 90 : 40);
    return `<span class="bibi-star" style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;font-size:${sz}px;--dx:${dx}px;--dy:${dy}px;--rot:${Math.round(Math.random() * 720 - 360)}deg;animation-delay:${(wave * .5 + Math.random() * 1.2).toFixed(2)}s">★</span>`;
  }).join('');
  wrap.innerHTML = `<img class="bibi-img" src="/static/img/bibi.png" alt="">${stars}`;
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 4200);
}
