// Powiadomienia o osiągnięciach: serwer dopisuje nagłówek X-Ach, a popup czeka na koniec animacji wyniku,
// żeby nie zdradzić, co wypadło.
import { api, net } from '../../api/client';
import { epicOpen } from '../../fx/effects';
import { syncInventory } from '../../game/session';
import { S } from '../../game/store';
import { esc } from '../../lib/format';
import { Sound } from '../../sound/sound';
import './popups.css';

const GRACE = 700, MAX_WAIT = 90000;   // ms: start animacji wyniku tuż po odpowiedzi serwera / zawieszona animacja nie zjada osiągnięcia
const state = { queue: [] as any[], showing: 0, polling: false, wait: 0 as any };
const TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';

const animBusy = () => (S.opening && !S.opening.shown) || epicOpen() || !!S.spinning || S.animHold > 0 || !!document.querySelector('.jp-anim, .money-stage .ms-result[hidden]');

async function resync(n: number): Promise<void> {
  if (n > 6) return;
  await syncInventory(null, true);
  if (net.inflight > 0 || S.opening) setTimeout(() => resync(n + 1), 2500);
}

export async function achPoll() {
  if (state.polling) return;
  state.polling = true;
  try {
    const d = await api('/api/achievements/pop', {}), at = Date.now();
    d.list.forEach((a: any) => state.queue.push({ ...a, at }));
    achPump();
    if (d.list.length) resync(0);
  } catch { /* powiadomienie to dodatek */ }
  state.polling = false;
}

export function achPump() {
  if (!state.queue.length) return;
  const first = state.queue[0], now = Date.now();
  if (now - first.at < MAX_WAIT && (now - first.at < GRACE || animBusy())) {
    if (!state.wait) state.wait = setTimeout(() => { state.wait = 0; achPump(); }, 400);
    return;
  }
  while (state.queue.length && state.showing < 3) popup(state.queue.shift());
}

function popup(a: any) {
  let host = document.getElementById('achToasts');
  if (!host) { host = document.createElement('div'); host.id = 'achToasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'ach-popup';
  el.innerHTML = `<div class="ach-pic">${TROPHY}</div><div class="ach-txt"><small>Osiągnięcie zdobyte</small><b>${esc(a.name)}</b><span>${esc(a.desc)}</span>${a.rewards.length ? `<em>${a.rewards.map(esc).join(' · ')}</em>` : ''}</div>`;
  host.appendChild(el);
  state.showing++;
  try { Sound.reveal('gold'); } catch { /* bez dźwięku */ }
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  const close = () => {
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => { el.remove(); state.showing--; achPump(); }, 500);
  };
  setTimeout(close, 6000);
  el.addEventListener('click', close);
}
