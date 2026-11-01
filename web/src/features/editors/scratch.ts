// @ts-nocheck -- edytor na canvasie, przeniesiony ze starego scratch.js
// Zdrapka: właściciel zdrapuje srebrną folię ze zdjęcia monetą. Zdrapana do końca karta zostaje odkryta na stałe i ten stan
// idzie za kartą do kolejnych właścicieli. Częściowe zdrapanie nie jest zapisywane: po zamknięciu okna folia wraca.
import { api } from '../../api/client';
import { cardHTML, scratchOpen } from '../../cards/cardHtml';
import { closeViewer, confetti } from '../../fx/effects';
import { variantParts } from '../../game/rules';
import { S, touch } from '../../game/store';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import './editors.css';

const SCR_DONE = 0.93;             // tyle folii trzeba zedrzeć, żeby karta się odkryła (resztę zdziera sama)
const isScratch = v => variantParts(v || "").includes("scratch");

// srebrna folia na canvasie: metaliczny gradient, ziarno i napis
function scratchFoil(c) {
  const g = c.getContext("2d", { willReadFrequently: true }), w = c.width, h = c.height;
  const grad = g.createLinearGradient(0, 0, w, h);
  [[0, "#e4e8ee"], [0.35, "#aab0ba"], [0.55, "#eef1f5"], [0.8, "#9ca2ac"], [1, "#dfe3e9"]].forEach(([o, col]) => grad.addColorStop(o, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 40; i++) {
    g.fillStyle = Math.random() < 0.5 ? "#ffffff30" : "#00000018";
    g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
  g.fillStyle = "#2a2a30";
  g.font = `800 ${Math.round(w / 13)}px Rubik, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("ZDRAP TUTAJ", w / 2, h / 2, w * 0.62);  // nie wchodzi pod plakietkę ZDRAPKA po prawej
}

// jaka część folii jest już zdrapana (co 4. piksel wystarczy)
function scratchCleared(c) {
  const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  let clear = 0, all = 0;
  for (let i = 3; i < d.length; i += 16) { all++; if (d[i] < 128) clear++; }
  return all ? clear / all : 1;
}

export function openScratch(uid) {
  const it = S.items.find(i => i.id === uid);
  if (!it || !isScratch(it.variant)) return toast("To nie jest twoja Zdrapka", true);
  if (S.scratched?.has(uid)) return toast("Ta karta jest już zdrapana");
  closeViewer();
  scratchOpen.add(uid);
  const el = document.createElement("div");
  el.className = "scr-editor";
  el.innerHTML = `
    <div class="scr-box">
      <h3>Zdrap kartę</h3>
      <p class="muted small">Przeciągnij monetą po srebrnym polu. Zdrapana do końca karta zostanie odkryta na zawsze.</p>
      <div class="scr-card">${cardHTML(it.person, it.variant, uid)}</div>
      <div class="scr-bar"><i></i><span>0%</span></div>
      <div class="scr-btns"><button class="ms-btn" data-scr="close">Zamknij</button></div>
    </div>`;
  scratchOpen.delete(uid);
  document.body.appendChild(el);
  Sound.unlock();

  const $ = s => el.querySelector(s);
  const wrap = $(".scr-card"), card = $(".card");
  const cw = Math.floor(Math.min(innerWidth - 48, (innerHeight - 230) * 63 / 88, 420));
  wrap.style.width = cw + "px";
  card.style.setProperty("--cw", cw + "px");
  card.style.width = cw + "px";
  const photo = card.querySelector(".card-photo, .sc-art");
  const pr = photo.getBoundingClientRect();
  const c = document.createElement("canvas");
  c.className = "scr-foil";
  c.width = Math.round(Math.min(480, pr.width * (devicePixelRatio || 1)));
  c.height = Math.round(c.width * pr.height / pr.width);
  photo.append(c);
  const coin = document.createElement("b");
  coin.className = "scr-coin";
  photo.append(coin);
  scratchFoil(c);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.globalCompositeOperation = "destination-out";
  g.lineCap = g.lineJoin = "round";
  g.lineWidth = c.width * 0.16;

  let last = null, lastCheck = 0, lastTick = 0, done = false;
  const pos = e => {
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height, e.clientX - r.left, e.clientY - r.top];
  };
  const progress = p => {
    const pct = Math.min(100, Math.round(p / SCR_DONE * 100));
    $(".scr-bar i").style.width = `${pct}%`;
    $(".scr-bar span").textContent = `${pct}%`;
  };
  const move = e => {
    const [x, y, px, py] = pos(e);
    coin.style.left = px + "px"; coin.style.top = py + "px";
    if (!last || done) return;
    g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(x, y); g.stroke();
    last = [x, y];
    const now = performance.now();
    if (now - lastTick > 90) { lastTick = now; try { Sound.tick(0.3); } catch { /* dźwięk nie jest konieczny */ } }
    if (now - lastCheck > 150) {
      lastCheck = now;
      const p = scratchCleared(c);
      progress(p);
      if (p >= SCR_DONE) finish();
    }
  };
  c.addEventListener("pointerdown", e => {
    if (done) return;
    c.setPointerCapture(e.pointerId);
    coin.classList.add("on");
    last = pos(e);
    g.beginPath(); g.arc(last[0], last[1], g.lineWidth / 2, 0, Math.PI * 2); g.fill();
    move(e);
  });
  c.addEventListener("pointermove", move);
  const up = () => { last = null; coin.classList.remove("on"); };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);

  async function finish() {
    done = true;
    last = null;
    coin.remove();
    c.classList.add("gone");   // resztę folii zdejmuje animacja
    progress(SCR_DONE);
    try { await api(`/api/items/${uid}/scratch`, {}); }
    catch (e) { Sound.error(); return toast(e.message, true); }
    S.scratched = S.scratched || new Set();
    S.scratched.add(uid);
    Sound.win();
    confetti(["#ffd21a", "#7a2ae0", "#c8ccd4", "#ffffff"], 120);
    $(".scr-btns").innerHTML = '<button class="ms-btn hue" data-scr="close">Gotowe</button>';
  }

  const close = () => {
    el.remove();
    if (done) touch();
  };
  el.addEventListener("click", e => { if (e.target.closest("[data-scr=close]") || e.target === el) close(); });
}
