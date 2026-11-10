// Rozmowa z serwerem gry: jedno zapytanie zwraca wszystko, czego bot potrzebuje

const GAME_URL = (process.env.GAME_URL || 'http://game:8000').replace(/\/$/, '');
const TOKEN = process.env.BOT_TOKEN || '';

export async function snapshot() {
  const res = await fetch(`${GAME_URL}/api/bot/snapshot`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error('Gra nie ma ustawionego BOT_TOKEN (endpoint /api/bot/snapshot wyłączony)');
  if (res.status === 401) throw new Error('BOT_TOKEN bota różni się od BOT_TOKEN gry');
  if (!res.ok) throw new Error(`Gra odpowiedziała ${res.status}`);
  return res.json();
}

async function get(pathAndQuery) {
  const res = await fetch(`${GAME_URL}${pathAndQuery}`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Gra odpowiedziała ${res.status}`);
  return res.json();
}

/** Dane gracza z rankingu: { found: false } albo profil */
export const player = (name) => get(`/api/bot/player?name=${encodeURIComponent(name)}`);

/** Podpowiedzi nazw graczy (do autouzupełniania) */
export const playerNames = async (q) => (await get(`/api/bot/player?q=${encodeURIComponent(q)}`)).names ?? [];

/** Nowe rzadkie dropy po id (bez `after`: tylko { max }, nic do ogłoszenia) */
export const drops = (after) => get(`/api/bot/drops${after == null ? '' : `?after=${after}`}`);

/** Połączone konta: [{ discordId, place }] */
export const links = () => get('/api/bot/links');

/** Kod do połączenia konta Discord z kontem w grze (albo { linked: true, username }) */
export async function linkCode(discordId) {
  const res = await fetch(`${GAME_URL}/api/bot/link-code`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ discordId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Gra odpowiedziała ${res.status}`);
  return res.json();
}

/** Podpowiedzi kart po nazwie: [{ id, name, rarity }] */
export const cardSearch = async (q) => (await get(`/api/bot/cards?q=${encodeURIComponent(q)}`)).cards ?? [];

/** Karta z możliwymi wariantami: { found, id, name, rarity, variants: [{ key, name, value }] } */
export const card = (id) => get(`/api/bot/cards?id=${encodeURIComponent(id)}`);
