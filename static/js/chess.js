"use strict";
// ZAKŁADKA GRY (/games) i SZACHY. Serwer zna zasady i zegar (server/src/chess.rs, routes/chess.rs) - tu tylko rysujemy stan
// i wysyłamy ruchy. Partia z graczem: odpytywanie co 2 s; trening z botem: odpowiedź bota przychodzi z ruchem.

const CH = { id: null, game: null, lobby: null, sel: null, poll: null, tick: null, busy: false, flip: false, promo: null, shownEnd: null };
const CH_FILES = "abcdefgh";
const CH_BOTS = [[1, "Początkujący"], [2, "Klubowy"], [3, "Mistrz"]];

function chStop() { clearInterval(CH.poll); clearInterval(CH.tick); CH.poll = CH.tick = null; }

async function renderGames() {
  chStop();
  if (CH.id) return chOpen(CH.id);
  const box = $("#gamesBody");
  if (!CH.lobby) box.innerHTML = '<div class="empty">Wczytuję…</div>';
  try { CH.lobby = await api("/api/games/chess"); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (currentView() !== "games") return;
  await skLoad();
  if (currentView() !== "games" || CH.id) return;
  chLobbyHTML();
  CH.poll = setInterval(chLobbyPoll, 4000);
}

async function chLobbyPoll() {
  if (currentView() !== "games" || CH.id) return;
  try {
    const was = CH.lobby?.open.find(o => o.mine)?.id, d = await api("/api/games/chess");
    if (JSON.stringify(d) === JSON.stringify(CH.lobby)) return;
    CH.lobby = d;
    // ktoś dołączył do mojej partii
    if (was && d.active === was) return chOpen(was);
    if (!$("#chLobby input:focus, #chLobby select:focus")) chLobbyHTML();
  } catch (_) {}
}

function chLobbyHTML() {
  const d = CH.lobby, mine = d.open.find(o => o.mine), others = d.open.filter(o => !o.mine);
  $("#gamesBody").innerHTML = `<div id="chLobby">
    <div class="gm-head"><h2>Gry</h2>
      <div class="gm-tabs"><span class="gm-tab active">Szachy</span><span class="gm-tab soon" title="Arena trafi tu w przyszłości">Arena <small>wkrótce</small></span></div></div>
    <p class="muted">Prawdziwe szachy: roszady, bicie w przelocie, promocje, mat, pat i remisy. Za wygraną z graczem dostajesz
      <b>skrzynkę daily</b> i <b>skrzynkę w kolorze, którym grałeś</b>: karta w wariancie Biała albo Czarna plus skin do figury. Kolor jest losowany przy starcie.
      Dzisiaj zostało nagród: <b>${d.rewardsLeft}/${d.rewardsPerDay}</b>. Partia musi trwać co najmniej ${d.minPlies} półruchów.</p>
    ${d.active && !mine ? `<div class="panel ch-resume"><b>Masz trwającą partię</b><button class="btn primary" data-chopen="${d.active}">Wróć do gry</button></div>` : ""}
    <div class="ch-grid">
      <div class="panel">
        <h3>Zagraj z graczem</h3>
        ${mine ? `<p>Czekasz na rywala · ${mine.minutes} min${mine.invited ? "" : ""}</p><button class="btn" data-chcancel="${mine.id}">Anuluj partię</button>` : `<div class="ch-form">
          <label>Czas <select id="chMin">${d.minutes.map(m => `<option value="${m}"${m === 10 ? " selected" : ""}>${m} min + 2 s</option>`).join("")}</select></label>
          <label class="wide">Zaproś gracza (puste = partia otwarta dla każdego)<input id="chInvite" type="text" maxlength="30" placeholder="nick"></label>
          <button class="btn primary wide" id="chCreate">Załóż partię</button></div>`}
      </div>
      <div class="panel">
        <h3>Trening z botem</h3>
        <p class="muted small">Bez zegara i bez nagród. Nowa partia zastępuje poprzednią.</p>
        <div class="ch-bots">${CH_BOTS.map(([n, t]) => `<button class="btn" data-chbot="${n}">${t}</button>`).join("")}</div>
        ${d.training ? `<button class="btn" data-chopen="${d.training}">Dokończ trening</button>` : ""}
        ${S.me?.isAdmin ? `<button class="btn" data-chtest="1" title="Admin: partia rozgrywa się sama i wygrywasz ją matem. Daje prawdziwą nagrodę, bez limitu na dobę.">Partia testowa</button>` : ""}
      </div>
    </div>
    ${skMenuHTML()}
    <div class="panel"><h3>Otwarte partie</h3>
      ${others.length ? `<div class="ch-list">${others.map(o => `<div class="ch-row"><span><b>${esc(o.by)}</b> · ${o.minutes} min${o.invited ? ' · <span class="pos-txt">zaproszenie dla ciebie</span>' : ""}</span>
        <button class="btn primary" data-chjoin="${o.id}">Dołącz</button></div>`).join("")}</div>` : '<p class="muted">Nikt teraz nie czeka. Załóż partię.</p>'}
    </div>
    ${d.history.length ? `<div class="panel"><h3>Ostatnie partie</h3><div class="ch-list">${d.history.map(h => `<div class="ch-row">
      <span>${h.outcome === "win" ? "Wygrana" : h.outcome === "loss" ? "Przegrana" : "Remis"} · ${esc(h.rival)} <small class="muted">${esc(h.reason)}</small></span>
      ${h.rewarded ? '<small class="muted">nagroda</small>' : ""}<button class="btn tiny" data-chopen="${h.id}">Zobacz</button></div>`).join("")}</div></div>` : ""}
  </div>`;
}

async function chPost(url, body = {}) {
  try { return await api(url, body); } catch (e) { toast(e.message, true); return null; }
}

async function chOpen(id) {
  chStop();
  CH.id = id; CH.sel = null; CH.game = null; CH.promo = null;
  try { CH.game = await api(`/api/games/chess/${id}`); } catch (e) { toast(e.message, true); CH.id = null; return renderGames(); }
  chDraw();
  if (CH.game.bot < 0) return chTestPlay(id);
  CH.poll = setInterval(chPoll, 2000);
  CH.tick = setInterval(chClocks, 250);
}

// partia testowa admina: serwer wykonuje kolejne ruchy z gotowego zapisu
async function chTestPlay(id) {
  while (CH.id === id && CH.game?.status === "active" && currentView() === "games") {
    await new Promise(r => setTimeout(r, 450));
    if (CH.id !== id) return;
    const g = await chPost(`/api/games/chess/${id}/test-step`);
    if (!g || CH.id !== id) return;
    CH.game = g;
    Sound.click();
    chDraw();
  }
}

async function chPoll() {
  if (currentView() !== "games" || !CH.id) return chStop();
  if (CH.busy || CH.game?.status === "finished") return;
  try {
    const g = await api(`/api/games/chess/${CH.id}`);
    if (CH.busy) return;
    const change = g.san.length !== CH.game.san.length || g.status !== CH.game.status || g.drawOffer !== CH.game.drawOffer;
    CH.game = g;
    if (change) { CH.sel = null; chDraw(); }
  } catch (_) {}
}

function chTime(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function chClocks() {
  const g = CH.game;
  if (!g?.timed || g.status !== "active") return;
  const key = g.turn === "w" ? "whiteMs" : "blackMs";
  g[key] -= 250;
  $$("[data-chclock]").forEach(e => { e.textContent = chTime(g[e.dataset.chclock === "w" ? "whiteMs" : "blackMs"]); });
}

// FEN -> tablica 64 pól od a8 do h1
function chSquares(fen) {
  const out = [];
  for (const c of fen.split(" ")[0].replaceAll("/", "")) {
    if (c >= "1" && c <= "8") out.push(...Array(+c).fill(null));
    else out.push(c);
  }
  return out;
}

function chPlayerHTML(g, side) {
  const p = side === "w" ? g.white : g.black;
  const on = g.status === "active" && g.turn === side;
  return `<div class="ch-player${on ? " on" : ""}"><span class="ch-who"><i class="ch-dot ${side}"></i>${esc(p.name)}</span>
    ${g.timed ? `<span class="ch-clock${on ? " on" : ""}" data-chclock="${side}">${chTime(side === "w" ? g.whiteMs : g.blackMs)}</span>` : ""}</div>`;
}

function chBoardHTML(g) {
  const sq = chSquares(g.fen), bottomBlack = (g.you === "b") !== CH.flip;
  const order = [...Array(64).keys()];
  if (bottomBlack) order.reverse();
  const from = CH.sel, targets = new Set((g.legal || []).filter(m => m.slice(0, 2) === from).map(m => m.slice(2, 4)));
  const last = g.last ? [g.last.slice(0, 2), g.last.slice(2, 4)] : [];
  return order.map(i => {
    const f = i % 8, r = 7 - Math.floor(i / 8), name = CH_FILES[f] + (r + 1), c = sq[i];
    const dark = (f + r) % 2 === 0, cls = [dark ? "dk" : "lt"];
    if (last.includes(name)) cls.push("last");
    if (name === from) cls.push("sel");
    if (name === g.check) cls.push("check");
    if (targets.has(name)) cls.push(c ? "take" : "move");
    const edgeF = bottomBlack ? r === 7 : r === 0, edgeR = bottomBlack ? f === 0 : f === 7;
    return `<div class="ch-sq ${cls.join(" ")}" data-sq="${name}">
      ${edgeF ? `<i class="ch-co f">${CH_FILES[f]}</i>` : ""}${edgeR ? `<i class="ch-co r">${r + 1}</i>` : ""}
      ${c ? chPieceHTML(g, c) : ""}</div>`;
  }).join("");
}

// figura ze skinem właściciela (rywal widzi swoje i moje); kolor strony zawsze w --f / --l
function chPieceHTML(g, c) {
  const white = c === c.toUpperCase(), p = c.toLowerCase(), skin = (white ? g.whiteSkins : g.blackSkins)?.[p];
  return `<span class="ch-pc ${white ? "w" : "b"}${skin ? " sk" : ""}">${skinSvg(skin, p)}</span>`;
}

function chEndText(g) {
  if (g.result === "draw") return `Remis: ${g.reason}`;
  const mine = (g.result === "white" && g.you === "w") || (g.result === "black" && g.you === "b");
  if (!g.you) return `Wygrały ${g.result === "white" ? "białe" : "czarne"}: ${g.reason}`;
  return mine ? `Wygrana: ${g.reason}` : `Przegrana: ${g.reason}`;
}

function chDraw() {
  const g = CH.game;
  if (!g || currentView() !== "games") return;
  const top = (g.you === "b") !== CH.flip ? "w" : "b", bottom = top === "w" ? "b" : "w";
  const moves = [];
  for (let i = 0; i < g.san.length; i += 2) moves.push(`<div class="ch-mv"><i>${i / 2 + 1}.</i><b>${esc(g.san[i])}</b><b>${esc(g.san[i + 1] || "")}</b></div>`);
  const playing = g.status === "active" && g.you && g.bot >= 0;
  const offer = g.drawOffer === "them"
    ? `<div class="ch-offer">Rywal proponuje remis <button class="btn tiny primary" data-chdraw="accept">Przyjmij</button><button class="btn tiny" data-chdraw="decline">Odrzuć</button></div>`
    : g.drawOffer === "me" ? '<div class="ch-offer muted">Czekasz na odpowiedź na propozycję remisu</div>' : "";
  $("#gamesBody").innerHTML = `<div class="ch-game">
    <div class="ch-left">
      <div class="ch-board${CH.busy ? " wait" : ""}" id="chBoard">${chBoardHTML(g)}</div>
    </div>
    <div class="ch-side panel">
      ${chPlayerHTML(g, top)}
      <div class="ch-status">${g.status === "finished" ? chEndText(g) : g.status === "open" ? "Czekam na rywala…" : g.bot < 0 ? "Partia testowa…" : !g.you ? "Oglądasz partię" : g.turn === g.you ? "Twój ruch" : g.bot ? "Bot myśli…" : "Ruch rywala"}</div>
      ${g.check && g.status === "active" ? '<div class="ch-alert">Szach!</div>' : ""}
      ${g.rewarded ? `<div class="ch-reward">Skrzynka daily i skrzynka ${g.result === "white" ? "Białych" : "Czarnych"} są w ekwipunku!</div>` : ""}
      ${offer}
      <div class="ch-moves" id="chMoves">${moves.join("") || '<p class="muted small">Jeszcze nie ma ruchów.</p>'}</div>
      <div class="ch-btns">
        ${playing ? `<button class="btn" data-chresign="1">Poddaj się</button>${!g.bot && !g.drawOffer ? '<button class="btn" data-chdraw="offer">Remis</button>' : ""}` : ""}
        <button class="btn" data-chflip="1">Obróć</button>
        <button class="btn" data-chback="1">Lobby</button>
      </div>
      ${chPlayerHTML(g, bottom)}
    </div>
    ${CH.promo ? `<div class="ch-promo"><div class="panel"><h3>Promocja piona</h3><div>${["q", "r", "b", "n"].map(p =>
      `<button class="ch-pick" data-chpromo="${p}"><span class="ch-pc ${g.you}">${skinSvg((g.you === "w" ? g.whiteSkins : g.blackSkins)?.[p], p)}</span></button>`).join("")}</div></div></div>` : ""}
  </div>`;
  const list = $("#chMoves");
  if (list) list.scrollTop = list.scrollHeight;
  if (g.status === "finished" && CH.shownEnd !== g.id) {
    CH.shownEnd = g.id;
    if (g.rewarded) { Sound.win(); confetti(["#ffffff", "#111111", "#8a8a8a"], 140); syncAfterChess(); }
  }
}

async function syncAfterChess() {
  try { const st = await api("/api/state"); S.chests = st.chests || S.chests; } catch (_) {}
}

async function chMove(uci) {
  CH.sel = null; CH.promo = null; CH.busy = true;
  chDraw();
  try { CH.game = await api(`/api/games/chess/${CH.id}/move`, { move: uci }); Sound.click(); }
  catch (e) { toast(e.message, true); }
  CH.busy = false;
  chDraw();
}

function chClick(name) {
  const g = CH.game;
  if (!g?.legal?.length || CH.busy) return;
  if (CH.sel && CH.sel !== name) {
    const m = g.legal.filter(x => x.startsWith(CH.sel + name));
    if (m.length > 1) { CH.promo = CH.sel + name; return chDraw(); }
    if (m.length === 1) return chMove(m[0]);
  }
  CH.sel = CH.sel === name || !g.legal.some(x => x.startsWith(name)) ? null : name;
  chDraw();
}

document.addEventListener("pointerup", e => {
  const sq = e.target.closest?.(".ch-sq");
  if (sq && !CH.promo) chClick(sq.dataset.sq);
});
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-chopen],[data-chjoin],[data-chcancel],[data-chbot],[data-chtest],[data-chback],[data-chflip],[data-chresign],[data-chdraw],[data-chpromo],#chCreate");
  if (!t) return;
  const d = t.dataset;
  if (d.chopen) return chOpen(+d.chopen);
  if (d.chjoin) { const r = await chPost(`/api/games/chess/${d.chjoin}/join`); return r && chOpen(r.id); }
  if (d.chcancel) { await chPost(`/api/games/chess/${d.chcancel}/cancel`); return renderGames(); }
  if (d.chbot) { const r = await chPost("/api/games/chess/create", { bot: +d.chbot }); return r && chOpen(r.id); }
  if (d.chtest) { const r = await chPost("/api/games/chess/test"); return r && chOpen(r.id); }
  if (d.chback) { CH.id = null; CH.game = null; return renderGames(); }
  if (d.chflip) { CH.flip = !CH.flip; return chDraw(); }
  if (d.chpromo) return chMove(CH.promo + d.chpromo);
  if (d.chresign) {
    if (!confirm("Na pewno chcesz się poddać?")) return;
    const r = await chPost(`/api/games/chess/${CH.id}/resign`);
    if (r) { CH.game = r; chDraw(); }
    return;
  }
  if (d.chdraw) { const r = await chPost(`/api/games/chess/${CH.id}/draw`, { action: d.chdraw }); if (r) { CH.game = r; chDraw(); } return; }
  if (t.id === "chCreate") {
    const r = await chPost("/api/games/chess/create", { minutes: +$("#chMin").value, invite: $("#chInvite").value });
    if (r) { CH.lobby = null; renderGames(); }
  }
});
