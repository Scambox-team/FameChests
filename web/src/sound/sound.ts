// @ts-nocheck -- kod rysujący na canvasie i w DOM-ie, przeniesiony bez zmian; typy dochodzą przy dalszym porządkowaniu
// Dźwięki: nagrania CC0 w static/sounds (skrzynki i kasyno z freesound.org - lista w CREDITS-freesound.txt, interfejs i karty
// z paczek Kenney - LICENSE.txt); reszta i zapas na czas wczytywania to syntezator Web Audio API.
export const Sound = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let enabled = true, volume = 1;   // głośność 0-1 (suwak przy ikonie dźwięku), mnoży główne wzmocnienie
  try { enabled = localStorage.getItem("sound") !== "off"; } catch (e) {}
  try { const v = parseFloat(localStorage.getItem("volume")); if (v >= 0 && v <= 1) volume = v; } catch (e) {}
  let lastTick = 0;

  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5 * volume;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, { type = "sine", vol = 0.3, attack = 0.005, slideTo = null, dest = null } = {}) {
    const c = ac();
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(dest || master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  function noise(start, dur, { vol = 0.3, freq = 2000, q = 1, type = "bandpass", slideTo = null } = {}) {
    const c = ac();
    const s = c.createBufferSource(); s.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, start); f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f).connect(g).connect(master);
    s.start(start); s.stop(start + dur + 0.05);
  }

  // ton z vibrato (LFO na wysokości), przesuwający się od "from" do "to"; tremolo - drganie głośności (Hz)
  function warble(start, dur, from, to, { rate = 6, depth = 20, vol = 0.1, type = "sine", tremolo = 0 } = {}) {
    const c = ac();
    const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, start);
    o.frequency.exponentialRampToValueAtTime(to, start + dur);
    lfo.frequency.value = rate; lg.gain.value = depth;
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + Math.min(0.25, dur / 4));
    g.gain.setValueAtTime(vol, start + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, start + dur);
    let out = g;
    if (tremolo) {
      const tg = c.createGain(), tl = c.createOscillator(), td = c.createGain();
      tg.gain.value = 0.6; tl.frequency.value = tremolo; td.gain.value = 0.4;
      tl.connect(td).connect(tg.gain);
      g.connect(tg); out = tg;
      tl.start(start); tl.stop(start + dur + 0.05);
    }
    o.connect(g); out.connect(master);
    o.start(start); lfo.start(start);
    o.stop(start + dur + 0.05); lfo.stop(start + dur + 0.05);
  }

  // niskie buczenie silnika (piła przez filtr dolnoprzepustowy)
  function hum(start, dur, freq, vol) {
    const c = ac();
    const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = "sawtooth"; o.frequency.value = freq;
    f.type = "lowpass"; f.frequency.value = 240;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.3);
    g.gain.setValueAtTime(vol, start + dur - 0.4);
    g.gain.linearRampToValueAtTime(0, start + dur);
    o.connect(f).connect(g).connect(master);
    o.start(start); o.stop(start + dur + 0.05);
  }

  // nagrania: klucz dźwięku w grze -> pliki (losowany jeden, żeby powtórzenia nie brzmiały identycznie)
  const SAMPLES = {
    click: ["click-1", "click-2"], select: ["select"], toggle: ["toggle"], error: ["error"],
    page: ["page-1", "page-2", "page-3"], whoosh: ["card-slide-1", "card-slide-2", "card-slide-3", "card-slide-4"],
    move: ["chess-move-1", "chess-move-2", "chess-move-3"], notify: ["pluck"], dice: ["dice-shake"],
    // skrzynki (freesound.org)
    open: ["fs-open-2.mp3"], tick: ["fs-tick.mp3"], land: ["fs-land.mp3"], deal: ["fs-deal.mp3", "fs-land.mp3"],
    rare: ["fs-rare.mp3"], epic: ["fs-epic.mp3"], mythic: ["fs-mythic.mp3"], charge: ["fs-charge.mp3"], boom: ["fs-boom.mp3"], stinger: ["fs-stinger.mp3"],
    gold: ["fs-gold.mp3"], ultra: ["fs-ultra.mp3"], secret: ["fs-secret.mp3"],
    // kasyno i wygrane (freesound.org)
    win: ["fs-win.mp3"], chips: ["fs-chips.mp3"], cash: ["fs-cash.mp3"], coin: ["fs-coin.mp3"], coins: ["fs-coins.mp3"], payout: ["fs-payout.mp3"], lose: ["fs-lose.mp3"]
  };
  const buffers = {}, loading = {}, norm = {};
  // nagrania z różnych źródeł mają bardzo różną głośność: wyrównujemy je do podobnej średniej (RMS), bez przesterowania szczytu
  function level(buf) {
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; }
    const rms = Math.sqrt(sum / d.length) || 1e-4;
    return Math.min(.09 / rms, .95 / (peak || 1), 14);
  }
  function load(name) {
    if (buffers[name] || loading[name]) return;
    loading[name] = fetch(`/static/sounds/${/\.\w+$/.test(name) ? name : name + '.ogg'}`).then(r => r.arrayBuffer()).then(b => ac().decodeAudioData(b)).then(buf => { norm[name] = level(buf); buffers[name] = buf; }).catch(() => {});
  }
  function preload() { Object.values(SAMPLES).flat().forEach(load); }
  // odtwarza nagranie; false = jeszcze się nie wczytało (wtedy gra syntezator)
  function sample(key, { vol = .8, rate = 1, delay = 0 } = {}) {
    const list = SAMPLES[key];
    const name = list[Math.floor(Math.random() * list.length)], buf = buffers[name];
    if (!buf) { preload(); return false; }
    const c = ac(), src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; src.playbackRate.value = rate; g.gain.value = vol * (norm[name] ?? 1) * 2.5;
    src.connect(g).connect(master);
    src.start(c.currentTime + delay);
    return true;
  }

  const N = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88,
              C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77,
              C6: 1046.5, D6: 1174.66, E6: 1318.5, G6: 1567.98, C7: 2093 };

  const api = {
    get enabled() { return enabled; },
    get volume() { return volume; },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, +v || 0));
      try { localStorage.setItem("volume", String(volume)); } catch (e) {}
      if (master) master.gain.setTargetAtTime(0.5 * volume, ctx.currentTime, 0.02);
    },
    jackpot() { if (enabled && !sample("payout", { vol: .75 })) api.win(); },
    move(mine = true) { if (enabled && !sample("move", { vol: mine ? .7 : .9, rate: mine ? 1 : .92 })) api.click(); if (enabled && !mine) sample("notify", { vol: .45, delay: .06 }); },
    deal() { if (enabled && !sample("deal", { vol: .7 })) api.page(); },
    dice() { if (enabled && !sample("dice", { vol: .7 })) api.click(); },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem("sound", enabled ? "on" : "off"); } catch (e) {}
      if (enabled) api.click();
      return enabled;
    },
    unlock() { if (enabled) { ac(); preload(); } },

    click() {
      if (!enabled) return;
      if (sample("click", { vol: .55 })) return;
      const t = ac().currentTime;
      tone(1400, t, 0.04, { type: "square", vol: 0.06 });
    },

    // tyknięcie bębna; speed 0..1 wpływa lekko na wysokość
    tick(speed = 1) {
      if (!enabled) return;
      const now = performance.now();
      if (now - lastTick < 28) return;
      lastTick = now;
      if (sample("tick", { vol: .5, rate: .85 + speed * .35 })) return;
      const t = ac().currentTime;
      noise(t, 0.03, { vol: 0.35, freq: 3500 + speed * 1500, q: 6 });
      tone(900 + speed * 500, t, 0.025, { type: "triangle", vol: 0.08 });
    },

    open() {
      if (!enabled) return;
      if (sample("open", { vol: .9 })) return;
      const t = ac().currentTime;
      // zatrzask
      noise(t, 0.06, { vol: 0.6, freq: 1200, q: 3 });
      tone(180, t, 0.12, { type: "square", vol: 0.12, slideTo: 90 });
      // świst
      noise(t + 0.05, 0.5, { vol: 0.25, freq: 400, q: 1.2, slideTo: 3000 });
      tone(220, t + 0.05, 0.45, { type: "sawtooth", vol: 0.05, slideTo: 880 });
    },

    land(rarity) {
      if (!enabled) return;
      if (sample("land", { vol: .7, rate: { gold: 1.05, ultra: 1.1 }[rarity] || 1 })) return;
      const t = ac().currentTime;
      const base = { green: N.C5, blue: N.D5, purple: N.E5, red: N.G5, gold: N.A5, ultra: N.C6 }[rarity] || N.C5;
      tone(base, t, 0.18, { type: "triangle", vol: 0.12 });
      noise(t, 0.05, { vol: 0.15, freq: 5000, q: 2 });
    },

    reveal(rarity) {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      const seqs = {
        green:  [N.C5, N.E5],
        blue:   [N.C5, N.E5, N.G5],
        purple: [N.C5, N.E5, N.G5, N.C6],
        red:    [N.D5, N.F5, N.A5, N.D6, N.F5 * 2],
      };
      if (rarity === "gold") return api.gold();
      if (rarity === "ultra") return api.ultra();
      if ({ blue: "rare", purple: "epic", red: "mythic" }[rarity] && sample({ blue: "rare", purple: "epic", red: "mythic" }[rarity], { vol: .75 })) return;
      (seqs[rarity] || seqs.green).forEach((f, i) => {
        tone(f, t + i * 0.07, 0.35, { type: "triangle", vol: 0.18 });
        tone(f * 2, t + i * 0.07, 0.2, { type: "sine", vol: 0.05 });
      });
      if (rarity === "red") {
        noise(t, 0.6, { vol: 0.2, freq: 6000, q: 0.7, type: "highpass" });
        tone(110, t, 0.5, { type: "sawtooth", vol: 0.1, slideTo: 55 });
      }
    },

    gold() {
      if (!enabled) return;
      if (sample("gold", { vol: .7 })) return;
      const t = ac().currentTime;
      // fanfara
      const melody = [[N.G4, 0], [N.C5, 0.12], [N.E5, 0.24], [N.G5, 0.36], [N.E5, 0.52], [N.G5, 0.62]];
      melody.forEach(([f, d]) => {
        tone(f, t + d, 0.3, { type: "sawtooth", vol: 0.08 });
        tone(f, t + d, 0.3, { type: "square", vol: 0.05 });
      });
      [N.C5, N.E5, N.G5, N.C6].forEach(f => tone(f, t + 0.78, 1.4, { type: "sawtooth", vol: 0.07, attack: 0.02 }));
      tone(65, t + 0.78, 1.2, { type: "sine", vol: 0.35 });
      // dzwoneczki
      for (let i = 0; i < 12; i++) tone(N.C6 * (1 + Math.random()), t + 0.8 + i * 0.07, 0.25, { vol: 0.05 });
      noise(t + 0.78, 1.2, { vol: 0.15, freq: 8000, q: 0.5, type: "highpass" });
    },

    // wariant MLG: trąbka na sprężone powietrze - trzy krótkie "BWA" i długie "BWAAA" (rozstrojony akord piłokształtny
    // przez filtr, z płaską głośnością zamiast wybrzmiewania jak w tone())
    // UFO (wizyta UFO w ekwipunku): przylot - drgający "theremin" schodzący w dół i niski szum silnika
    ufoArrive() {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      warble(t, 1.5, 1400, 520, { rate: 7, depth: 60, vol: 0.12 });
      warble(t + 0.05, 1.5, 700, 260, { rate: 7.3, depth: 30, vol: 0.06, type: "triangle" });
      hum(t, 1.6, 62, 0.16);
      noise(t, 1.4, { vol: 0.08, freq: 600, q: 0.7, type: "lowpass", slideTo: 260 });
    },
    // promień: lśniący akord wznoszący się w górę z tremolo + szum "zasysania"
    ufoBeam() {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      [1, 1.25, 1.5, 2].forEach((m, i) => warble(t + i * 0.04, 2.4, 260 * m, 900 * m, { rate: 11 + i, depth: 8 * m, vol: 0.05, tremolo: 9 }));
      hum(t, 2.5, 55, 0.12);
      noise(t + 0.2, 2.2, { vol: 0.07, freq: 300, q: 1.5, slideTo: 5200 });
      tone(N.C7, t + 2.15, 0.35, { type: "sine", vol: 0.08 });   // "pyk" - karta w środku
    },
    // odlot: szybki świst w górę z efektem Dopplera
    ufoLeave() {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      warble(t, 1.0, 500, 2600, { rate: 16, depth: 90, vol: 0.11 });
      warble(t + 0.08, 0.9, 250, 1300, { rate: 15, depth: 40, vol: 0.05, type: "triangle" });
      noise(t, 0.9, { vol: 0.09, freq: 800, q: 1, slideTo: 6000 });
    },

    airhorn() {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2600; f.Q.value = 2;
      f.connect(master);
      [[0, 0.15], [0.2, 0.15], [0.4, 0.15], [0.62, 0.75]].forEach(([d, len]) => {
        [349.23, 440, 523.25, 698.46].forEach((hz, i) => {
          const o = c.createOscillator(), g = c.createGain(), s = t + d;
          o.type = "sawtooth";
          o.frequency.setValueAtTime(hz * (i % 2 ? 1.006 : 0.994), s);
          o.frequency.linearRampToValueAtTime(hz * 0.985, s + len);
          g.gain.setValueAtTime(0, s);
          g.gain.linearRampToValueAtTime(0.07, s + 0.02);
          g.gain.setValueAtTime(0.07, s + len - 0.04);
          g.gain.linearRampToValueAtTime(0, s + len);
          o.connect(g).connect(f);
          o.start(s); o.stop(s + len + 0.05);
        });
      });
    },

    ultra(noRise = false) {
      if (!enabled) return;
      if (sample("ultra", { vol: .75 })) return;
      const t = ac().currentTime;
      // narastanie
      if (!noRise) {
        tone(110, t, 1.0, { type: "sawtooth", vol: 0.1, slideTo: 880, attack: 0.6 });
        noise(t, 1.0, { vol: 0.25, freq: 300, q: 1, slideTo: 9000 });
      }
      // uderzenie
      const hit = t + (noRise ? 0 : 1.0);
      tone(55, hit, 1.8, { type: "sine", vol: 0.5 });
      noise(hit, 0.4, { vol: 0.5, freq: 200, q: 0.8, type: "lowpass" });
      // akord tęczowy
      [N.C4, N.G4, N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => {
        tone(f, hit + i * 0.03, 2.2, { type: "sawtooth", vol: 0.05, attack: 0.03 });
        tone(f * 1.005, hit + i * 0.03, 2.2, { type: "triangle", vol: 0.05, attack: 0.03 });
      });
      // arpeggio
      const arp = [N.C6, N.E6, N.G6, N.C7, N.G6, N.E6, N.C6, N.E6, N.G6, N.C7];
      arp.forEach((f, i) => tone(f, hit + 0.2 + i * 0.08, 0.3, { type: "square", vol: 0.04 }));
      noise(hit, 2.0, { vol: 0.12, freq: 9000, q: 0.5, type: "highpass" });
    },

    coin(n = 1) {
      if (!enabled) return;
      if (sample(n > 3 ? "coins" : "coin", { vol: .7 })) return;
      const t = ac().currentTime;
      const reps = Math.min(n, 5);
      for (let i = 0; i < reps; i++) {
        const s = t + i * 0.08;
        tone(N.B5, s, 0.08, { type: "square", vol: 0.08 });
        tone(N.E6, s + 0.07, 0.3, { type: "square", vol: 0.08 });
      }
    },

    error() {
      if (!enabled) return;
      if (sample("error", { vol: .6 })) return;
      const t = ac().currentTime;
      tone(200, t, 0.15, { type: "square", vol: 0.1 });
      tone(150, t + 0.15, 0.25, { type: "square", vol: 0.1 });
    },

    page() {
      if (!enabled) return;
      if (sample("page", { vol: .7 })) return;
      const t = ac().currentTime;
      noise(t, 0.25, { vol: 0.25, freq: 1500, q: 0.6, slideTo: 600 });
    },
    // narastający dźwięk przed wielkim odsłonięciem
    charge(dur = 1.4, ultra = false) {
      if (!enabled) return;
      if (sample("charge", { vol: ultra ? .8 : .65, rate: Math.max(.7, Math.min(2.2, 3.05 / dur)) })) return;   // nagranie trwa 3 s: dopasowujemy do czasu ładowania
      const t = ac().currentTime;
      tone(ultra ? 70 : 110, t, dur, { type: "sawtooth", vol: 0.12, slideTo: ultra ? 1400 : 880, attack: dur * 0.8 });
      tone(ultra ? 72 : 112, t, dur, { type: "square", vol: 0.05, slideTo: ultra ? 1420 : 890, attack: dur * 0.8 });
      noise(t, dur, { vol: 0.3, freq: 200, q: 1.5, slideTo: ultra ? 12000 : 7000 });
      // bicie serca
      const beats = Math.floor(dur / 0.25);
      for (let i = 0; i < beats; i++) {
        const s = t + i * dur / beats;
        tone(60, s, 0.12, { type: "sine", vol: 0.25 + 0.3 * i / beats });
      }
    },

    boom(ultra = false) {
      if (!enabled) return;
      if (sample("boom", { vol: .9 })) { if (ultra) sample("stinger", { vol: .55 }); return; }
      const t = ac().currentTime;
      tone(ultra ? 45 : 60, t, ultra ? 2.2 : 1.4, { type: "sine", vol: 0.7, slideTo: 30 });
      noise(t, ultra ? 1.2 : 0.7, { vol: 0.7, freq: 900, q: 0.4, type: "lowpass", slideTo: 80 });
      noise(t, 0.15, { vol: 0.5, freq: 3000, q: 0.5 });
    },

    // drukarka paragonów: terkot na każdą linię (jak keyframes rcpFeed) + szum silniczka
    print(dur = 3, lines = 24) {
      if (!enabled) return;
      const t = ac().currentTime;
      for (let i = 0; i < lines; i++) {
        const s = t + i * dur / lines;
        noise(s, 0.05, { vol: 0.22, freq: 2400 + (i % 3) * 500, q: 4 });
        tone(1700 + (i % 4) * 90, s, 0.035, { type: "square", vol: 0.035 });
      }
      tone(120, t, dur, { type: "sawtooth", vol: 0.03 });
    },
    // koniec wydruku: oderwanie papieru i dzwonek
    tear() {
      if (!enabled) return;
      const t = ac().currentTime;
      noise(t, 0.2, { vol: 0.4, freq: 1800, q: 0.8, slideTo: 6500 });
      tone(2093, t + 0.12, 0.35, { type: "sine", vol: 0.1 });
      tone(2637, t + 0.22, 0.6, { type: "sine", vol: 0.09 });
    },

    whoosh() {
      if (!enabled) return;
      if (sample("whoosh", { vol: .55 })) return;
      const t = ac().currentTime;
      noise(t, 0.6, { vol: 0.35, freq: 300, q: 1, slideTo: 4000 });
    },

    win() {
      if (!enabled) return;
      if (sample("win", { vol: .7 })) { sample("chips", { vol: .5, delay: .12 }); return; }
      const t = ac().currentTime;
      [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => {
        tone(f, t + i * 0.06, 0.5, { type: "square", vol: 0.07 });
        tone(f, t + i * 0.06, 0.6, { type: "triangle", vol: 0.12 });
      });
      noise(t + 0.3, 0.8, { vol: 0.12, freq: 9000, q: 0.5, type: "highpass" });
    },

    fail() {
      if (!enabled) return;
      if (sample("lose", { vol: .55 })) return;
      const t = ac().currentTime;
      noise(t, 0.35, { vol: 0.6, freq: 2500, q: 0.8 });     // trzask
      noise(t + 0.05, 0.6, { vol: 0.3, freq: 600, q: 0.6, slideTo: 100 });
      [N.E4, N.D4, N.C4 * 0.9].forEach((f, i) => tone(f, t + 0.15 + i * 0.18, 0.4, { type: "sawtooth", vol: 0.08, slideTo: f * 0.85 }));
    },

    cash() {
      if (!enabled) return;
      if (sample("cash", { vol: .7 })) return;
      const t = ac().currentTime;
      noise(t, 0.08, { vol: 0.5, freq: 1800, q: 2 });
      tone(N.E6, t + 0.05, 0.6, { type: "sine", vol: 0.15 });
      tone(N.G6, t + 0.05, 0.6, { type: "sine", vol: 0.1 });
      for (let i = 0; i < 8; i++) tone(N.B5 * (1 + Math.random() * 0.5), t + 0.15 + i * 0.05, 0.15, { type: "square", vol: 0.04 });
    },
    // ciemny, niski dron z biciem serca - początek odsłonięcia tajnej karty
    drone(ms = 3000) {
      if (!enabled) return;
      const t = ac().currentTime, d = ms / 1000;
      tone(41, t, d + 0.5, { type: "sawtooth", vol: 0.08, attack: d * 0.6 });
      tone(41.6, t, d + 0.5, { type: "sine", vol: 0.25, attack: d * 0.5 });
      tone(82, t, d + 0.5, { type: "triangle", vol: 0.06, attack: d * 0.7 });
      noise(t, d, { vol: 0.12, freq: 120, q: 2, type: "lowpass", slideTo: 400 });
      const beats = Math.max(3, Math.floor(d / 0.55));
      for (let i = 0; i < beats; i++) {
        const s = t + i * d / beats;
        tone(55, s, 0.14, { type: "sine", vol: 0.35 + 0.25 * i / beats });
        tone(50, s + 0.16, 0.12, { type: "sine", vol: 0.25 + 0.2 * i / beats });
      }
    },

    // chór + dzwony - wielkie odsłonięcie tajnej karty
    choir() {
      if (!enabled) return;
      if (sample("secret", { vol: .75 })) return;
      const c = ac(), t = c.currentTime;
      const chord = [N.C4, N.G4, N.C5, N.E5, N.G5, N.C6];
      chord.forEach((f, i) => {
        // kilka lekko rozstrojonych głosów = efekt chóru
        [-0.006, 0, 0.006].forEach(det => {
          const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
          o.type = i < 2 ? "sawtooth" : "triangle";
          o.frequency.value = f * (1 + det);
          lfo.frequency.value = 5 + Math.random(); lg.gain.value = f * 0.004;
          lfo.connect(lg).connect(o.frequency);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(i < 2 ? 0.03 : 0.045, t + 0.6);
          g.gain.linearRampToValueAtTime(0.03, t + 3);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
          o.connect(g).connect(master);
          o.start(t); lfo.start(t); o.stop(t + 5.1); lfo.stop(t + 5.1);
        });
      });
      // dzwony
      [N.C6, N.G5, N.E6, N.C6 * 2].forEach((f, i) => {
        const s = t + 0.4 + i * 0.55;
        tone(f, s, 2.2, { type: "sine", vol: 0.16 });
        tone(f * 2.76, s, 1.2, { type: "sine", vol: 0.05 });
        tone(f * 5.4, s, 0.6, { type: "sine", vol: 0.02 });
      });
      noise(t, 3, { vol: 0.08, freq: 9000, q: 0.4, type: "highpass" });
    },
    // ---- wyścigi konne
    // rżenie: piłokształtny głos z wysokim "iiiih", drżeniem i opadaniem na końcu; pitch - wysokość głosu konia
    neigh(pitch = 1, vol = 0.1, len = 1) {
      if (!enabled) return;
      const c = ac(), t = c.currentTime + 0.01, d = (0.75 + Math.random() * 0.45) * len;
      const o = c.createOscillator(), g = c.createGain(), f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
      const lfo = c.createOscillator(), lg = c.createGain(), trem = c.createOscillator(), tg = c.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(420 * pitch, t);
      o.frequency.linearRampToValueAtTime(1350 * pitch, t + 0.13 * len);
      o.frequency.exponentialRampToValueAtTime(900 * pitch, t + d * 0.4);
      o.frequency.exponentialRampToValueAtTime(1100 * pitch, t + d * 0.55);
      o.frequency.exponentialRampToValueAtTime(280 * pitch, t + d);
      lfo.frequency.value = 24; lg.gain.value = 55 * pitch;      // drżenie wysokości
      lfo.connect(lg).connect(o.frequency);
      f1.type = "bandpass"; f1.frequency.value = 1000 * pitch; f1.Q.value = 3;
      f2.type = "bandpass"; f2.frequency.value = 2600; f2.Q.value = 2;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.05);
      g.gain.setValueAtTime(vol, t + d * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      trem.frequency.value = 13; tg.gain.value = vol * 0.4;       // "hihihi"
      trem.connect(tg).connect(g.gain);
      o.connect(f1).connect(g); o.connect(f2).connect(g);
      g.connect(master);
      o.start(t); lfo.start(t); trem.start(t);
      o.stop(t + d + 0.05); lfo.stop(t + d + 0.05); trem.stop(t + d + 0.05);
      noise(t, d * 0.5, { vol: vol * 0.5, freq: 3200, q: 0.8 });   // parskanie
    },
    // tętent: kilka głuchych uderzeń kopyt
    gallop(vol = 0.06) {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      [0, 0.1, 0.2, 0.32].forEach((d, i) => noise(t + d, 0.09, { vol: vol * (i === 3 ? 1 : 0.7), freq: 220, q: 2, type: "lowpass" }));
    },
    // turbo: tęczowe, wznoszące się arpeggio
    rainbow() {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      [0, 2, 4, 7, 9, 12, 14, 16, 19, 24].forEach((st, i) => tone(392 * Math.pow(2, st / 12), t + i * 0.055, 0.28,
        { type: i % 2 ? "square" : "triangle", vol: 0.07 }));
      tone(180, t, 0.8, { type: "sawtooth", vol: 0.07, slideTo: 1400 });
    },
    // upadek / kraksa
    crash() {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      noise(t, 0.35, { vol: 0.25, freq: 900, q: 0.7, slideTo: 120 });
      tone(160, t, 0.3, { type: "square", vol: 0.12, slideTo: 40 });
    },
    // smutny puzon: koń zdechł
    sadTrombone() {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      [[233, 0, 0.35], [220, 0.4, 0.35], [208, 0.8, 0.35], [196, 1.2, 0.9]].forEach(([hz, d, len], i) =>
        tone(hz, t + d, len, { type: "sawtooth", vol: 0.09, slideTo: i === 3 ? hz * 0.8 : null }));
    },
    // klakson samochodu (i silnik)
    carHorn() {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      tone(440, t, 0.6, { type: "square", vol: 0.1 }); tone(554, t, 0.6, { type: "square", vol: 0.1 });
      tone(440, t + 0.75, 0.6, { type: "square", vol: 0.1 }); tone(554, t + 0.75, 0.6, { type: "square", vol: 0.1 });
      noise(t, 3, { vol: 0.12, freq: 160, q: 2, type: "lowpass", slideTo: 400 });
    },
    // skrzynka z przedmiotem: dwa wesołe dźwięki
    pickup() {
      if (!enabled) return;
      const t = ac().currentTime;
      tone(784, t, 0.12, { type: "triangle", vol: 0.08 }); tone(1175, t + 0.08, 0.2, { type: "triangle", vol: 0.08 });
    },
    // położenie skórki od banana
    pop() {
      if (!enabled) return;
      const t = ac().currentTime;
      tone(300, t, 0.1, { type: "sine", vol: 0.12, slideTo: 700 });
    },
    // rakieta: świst
    whoosh() {
      if (!enabled) return;
      const t = ac().currentTime;
      noise(t, 0.8, { vol: 0.14, freq: 500, q: 1.5, slideTo: 3500 });
    },
    // trafienie rakietą: wybuch
    boom() {
      if (!enabled) return;
      const t = ac().currentTime;
      noise(t, 0.6, { vol: 0.35, freq: 1200, q: 0.6, slideTo: 80, type: "lowpass" });
      tone(90, t, 0.5, { type: "sawtooth", vol: 0.2, slideTo: 30 });
    },
    // grzyb: wznoszące "bip-bip-biiip"
    boost() {
      if (!enabled) return;
      const t = ac().currentTime;
      [0, 0.07, 0.14].forEach((d, i) => tone(500 * (1 + i * 0.35), t + d, 0.12, { type: "square", vol: 0.06 }));
      tone(400, t + 0.2, 0.4, { type: "sawtooth", vol: 0.06, slideTo: 1600 });
    },
    // ślimak: opadające "uuuu"
    slowdown() {
      if (!enabled) return;
      const t = ac().currentTime;
      tone(500, t, 0.7, { type: "sawtooth", vol: 0.07, slideTo: 90 });
    },
    // piorun
    zap() {
      if (!enabled) return;
      const t = ac().currentTime;
      noise(t, 0.4, { vol: 0.3, freq: 6000, q: 0.5, type: "highpass", slideTo: 800 });
      tone(1800, t, 0.25, { type: "square", vol: 0.08, slideTo: 200 });
    },
    // gwiazda: błyszczące arpeggio
    starup() {
      if (!enabled) return;
      const t = ac().currentTime;
      [0, 4, 7, 12, 16, 19, 24].forEach((st, i) => tone(523 * Math.pow(2, st / 12), t + i * 0.05, 0.18, { type: "triangle", vol: 0.07 }));
    },
    // poślizg na skórce od banana: gwizd w dół i bęc
    slip() {
      if (!enabled) return;
      const t = ac().currentTime;
      tone(1400, t, 0.45, { type: "sine", vol: 0.12, slideTo: 200 });
      noise(t + 0.45, 0.15, { vol: 0.2, freq: 300, q: 1, type: "lowpass" });
    },
    // kogut / start: gwizdek sędziego
    whistle() {
      if (!enabled) return;
      const c = ac(), t = c.currentTime;
      warble(t, 0.5, 2600, 2900, { rate: 28, depth: 120, vol: 0.09, type: "sine" });
    },
    // pinball (features/pinball): same syntezatory, krótkie, bo lecą co chwilę; p = wysokość / siła
    pin(kind, p = 1) {
      if (!enabled) return;
      const t = ac().currentTime;
      switch (kind) {
        case "flip": noise(t, 0.06, { vol: 0.22, freq: 900, q: 0.8, type: "lowpass" }); tone(110, t, 0.07, { type: "square", vol: 0.05 }); break;
        case "bumper": tone(520 * p, t, 0.12, { type: "square", vol: 0.07, slideTo: 260 * p }); noise(t, 0.05, { vol: 0.12, freq: 3000, q: 2 }); break;
        case "sling": tone(300, t, 0.08, { type: "sawtooth", vol: 0.06, slideTo: 140 }); noise(t, 0.04, { vol: 0.14, freq: 1800, q: 1 }); break;
        case "wall": noise(t, 0.04, { vol: Math.min(0.16, 0.05 * p), freq: 600, q: 1, type: "lowpass" }); break;
        case "lane": tone(N.E6 * p, t, 0.18, { type: "triangle", vol: 0.08 }); tone(N.E6 * p * 1.5, t + 0.06, 0.2, { type: "triangle", vol: 0.06 }); break;
        case "drop": tone(180, t, 0.12, { type: "square", vol: 0.07, slideTo: 70 }); noise(t, 0.08, { vol: 0.2, freq: 500, q: 1, type: "lowpass" }); break;
        case "target": tone(880 * p, t, 0.1, { type: "square", vol: 0.06 }); break;
        case "saucer": tone(200, t, 0.5, { type: "sawtooth", vol: 0.07, slideTo: 900 }); tone(300, t, 0.5, { type: "sine", vol: 0.06, slideTo: 1350 }); break;
        case "launch": noise(t, 0.35 * p + 0.1, { vol: 0.25, freq: 300, q: 1, type: "bandpass", slideTo: 2500 }); break;
        case "charge": tone(80 + 400 * p, t, 0.05, { type: "sine", vol: 0.03 }); break;
        case "drain": tone(440, t, 0.9, { type: "sawtooth", vol: 0.08, slideTo: 55 }); tone(330, t + 0.1, 0.9, { type: "square", vol: 0.04, slideTo: 41 }); break;
        case "save": [N.C5, N.G5, N.C6].forEach((f, i) => tone(f, t + i * 0.07, 0.15, { type: "square", vol: 0.06 })); break;
        case "bank": [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, t + i * 0.055, 0.18, { type: "square", vol: 0.06 })); break;
        case "jackpot": [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6, N.E6, N.G6].forEach((f, i) => { tone(f, t + i * 0.08, 0.22, { type: "sawtooth", vol: 0.05 }); tone(f / 2, t + i * 0.08, 0.22, { type: "square", vol: 0.04 }); }); break;
        case "start": [N.A4, N.C5, N.E5, N.A5].forEach((f, i) => tone(f, t + i * 0.12, 0.3, { type: "sawtooth", vol: 0.06 })); break;
        case "over": [N.A4, N.F4, N.D4, N.A4 / 2].forEach((f, i) => tone(f, t + i * 0.22, 0.4, { type: "sawtooth", vol: 0.07 })); break;
        case "tilt": tone(90, t, 0.8, { type: "square", vol: 0.1 }); break;
        // poziomy 2-5: teleport, czarna dziura, wiatraczek, trampolina, pałeczka, wiatr, maź, kaczka, skała, fanfara poziomu
        case "portal": tone(300, t, 0.22, { type: "sine", vol: 0.07, slideTo: 1300 }); tone(1300, t + 0.1, 0.22, { type: "triangle", vol: 0.05, slideTo: 380 }); break;
        case "hole": tone(260, t, 0.55, { type: "sawtooth", vol: 0.08, slideTo: 38 }); noise(t, 0.5, { vol: 0.16, freq: 350, q: 1, type: "lowpass" }); break;
        case "holeout": noise(t, 0.3, { vol: 0.26, freq: 400, q: 1, slideTo: 3200 }); tone(60, t, 0.25, { type: "square", vol: 0.09, slideTo: 320 }); break;
        case "spinner": tone(1400 * p, t, 0.03, { type: "square", vol: 0.035 }); tone(1900 * p, t + 0.035, 0.03, { type: "square", vol: 0.03 }); break;
        case "boing": tone(180 * p, t, 0.32, { type: "sine", vol: 0.1, slideTo: 640 * p }); tone(360 * p, t + 0.05, 0.28, { type: "triangle", vol: 0.05, slideTo: 900 * p }); break;
        case "blade": noise(t, 0.08, { vol: 0.2, freq: 4200, q: 3 }); tone(950, t, 0.07, { type: "sawtooth", vol: 0.05, slideTo: 300 }); break;
        case "fan": noise(t, 0.6, { vol: 0.07, freq: 800, q: 0.7, type: "bandpass", slideTo: 1500 }); break;
        case "goo": tone(150, t, 0.18, { type: "sine", vol: 0.06, slideTo: 85 }); tone(110, t + 0.1, 0.16, { type: "sine", vol: 0.04, slideTo: 70 }); break;
        case "quack": tone(720 * p, t, 0.07, { type: "sawtooth", vol: 0.06, slideTo: 360 }); tone(520 * p, t + 0.08, 0.1, { type: "sawtooth", vol: 0.05, slideTo: 250 }); break;
        case "rock": noise(t, 0.09, { vol: 0.2, freq: 450, q: 1, type: "lowpass" }); tone(120 * p, t, 0.09, { type: "square", vol: 0.05, slideTo: 70 }); break;
        // strzelnica: wystrzał, blaszana kaczka, złota kaczka, pudło, sygnał końca czasu
        case "shot": noise(t, 0.09, { vol: 0.3, freq: 2600, q: 0.8, type: "highpass" }); tone(170, t, 0.07, { type: "square", vol: 0.08, slideTo: 60 }); break;
        case "clang": tone(1250 * p, t, 0.22, { type: "triangle", vol: 0.1, slideTo: 900 * p }); tone(1900 * p, t, 0.1, { type: "square", vol: 0.04 }); noise(t, 0.04, { vol: 0.1, freq: 4200, q: 2 }); break;
        case "goldduck": [N.C6, N.E6, N.G6, N.C6 * 2].forEach((f, i) => tone(f, t + i * 0.05, 0.2, { type: "triangle", vol: 0.07 })); tone(1250, t, 0.2, { type: "triangle", vol: 0.08, slideTo: 900 }); break;
        case "miss": noise(t, 0.05, { vol: 0.12, freq: 700, q: 1, type: "lowpass" }); break;
        case "tick": tone(1100, t, 0.05, { type: "square", vol: 0.05 }); break;
        case "level": for (let i = 0; i < 3 + p; i++) tone(N.C5 * Math.pow(2, [0, 4, 7, 12, 16, 19][i % 6] / 12), t + 0.5 + i * 0.09, 0.2, { type: "square", vol: 0.05 }); break;
      }
    },
  };
  return api;
})();
