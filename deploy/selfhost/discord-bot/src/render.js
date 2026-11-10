// Karty jako obrazki. Karta w grze to HTML + CSS (warianty, połysk, ozdoby), więc bot nie rysuje jej sam: otwiera w Chromium
// stronę /render/card gry (na ukrytym koncie technicznym) i robi zrzut samej karty. Obrazek wygląda tak jak w grze;
// animacje wariantów są w nim zatrzymane w jednym kadrze.

import dns from 'node:dns/promises';
import net from 'node:net';
import puppeteer from 'puppeteer-core';

const GAME_URL = (process.env.GAME_URL || 'http://game:8000').replace(/\/$/, '');
const TOKEN = process.env.BOT_TOKEN || '';
const CHROMIUM = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

const CACHE_MAX = 150;
const CACHE_TTL_MS = 30 * 60_000;
const PARALLEL = 2;

let browser = null;
let cookie = null; // { name, value }: sesja konta technicznego
const cache = new Map(); // "pid|variant" -> { at, buf }
let active = 0;
const waiting = [];

async function slot() {
  if (active >= PARALLEL) await new Promise((r) => waiting.push(r));
  active += 1;
}
function release() {
  active -= 1;
  waiting.shift()?.();
}

// Chromium zajmuje ~250 MB, a karty rysuje się rzadko: po 2 minutach bez zleceń przeglądarka jest zamykana
// (bot wraca do ~60 MB) i startuje od nowa przy następnej karcie
const IDLE_CLOSE_MS = 2 * 60_000;
let idleTimer = null;
function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (active === 0 && browser) browser.close().catch(() => {});
  }, IDLE_CLOSE_MS);
  idleTimer.unref();
}

async function getBrowser() {
  if (browser?.connected) return browser;
  browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none', '--hide-scrollbars'],
  });
  browser.on('disconnected', () => {
    browser = null;
  });
  return browser;
}

/** Adres gry dla Chromium: po IP, bo nazwa usługi w Dockerze może wyglądać jak domena z listy HSTS (np. "app", "dev")
 *  i przeglądarka na siłę wchodzi wtedy przez https */
async function browserBase() {
  const u = new URL(GAME_URL);
  if (net.isIP(u.hostname) || u.hostname === 'localhost') return GAME_URL;
  const { address } = await dns.lookup(u.hostname, { family: 4 });
  u.hostname = address;
  return u.origin;
}

async function session() {
  if (cookie) return cookie;
  const res = await fetch(`${GAME_URL}/api/bot/render-session`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Gra nie dała sesji dla renderu (${res.status})`);
  const raw = res.headers.getSetCookie?.()[0] ?? '';
  const [pair] = raw.split(';');
  const i = pair.indexOf('=');
  if (i < 1) throw new Error('Gra nie zwróciła ciasteczka sesji');
  cookie = { name: pair.slice(0, i), value: pair.slice(i + 1) };
  return cookie;
}

async function shot(pid, variant) {
  const c = await session();
  const base = await browserBase();
  const page = await (await getBrowser()).newPage();
  try {
    await page.setViewport({ width: 900, height: 1300, deviceScaleFactor: 2 });
    // ciasteczko bez flagi Secure: w sieci Dockera gra stoi na http://, a Chromium nie wysyła Secure przez http
    await page.setCookie({ name: c.name, value: c.value, url: base, httpOnly: true, secure: false });
    const q = new URLSearchParams({ pid, variant: variant || 'normal' });
    await page.goto(`${base}/render/card?${q}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('#render-card[data-ready]', { timeout: 25_000 });
    if ((await page.$eval('#render-card', (n) => n.dataset.ready)) !== '1') throw new Error('Nie ma takiej karty');
    const frame = await page.$('#render-frame');
    return Buffer.from(await frame.screenshot({ type: 'png', omitBackground: true }));
  } finally {
    await page.close().catch(() => {});
  }
}

/** PNG karty (bufor). Powtórzone zapytania biorą obrazek z pamięci przez 30 minut. */
export async function renderCard(pid, variant = 'normal') {
  const key = `${pid}|${variant}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.buf;

  await slot();
  try {
    let buf;
    try {
      buf = await shot(pid, variant);
    } catch (e) {
      // sesja mogła wygasnąć albo przeglądarka paść: jedna powtórka na świeżym ciasteczku
      cookie = null;
      if (browser) await browser.close().catch(() => {});
      browser = null;
      buf = await shot(pid, variant);
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), buf });
    return buf;
  } finally {
    scheduleIdleClose();
    release();
  }
}

export async function closeRenderer() {
  await browser?.close().catch(() => {});
}
