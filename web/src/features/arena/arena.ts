// Arena w tle (ładowana leniwie, tylko gdy gracz ma dostęp): co kilka sekund sprawdza wyzwania od innych graczy
// i trwający mecz, pokazuje okienko z wyzwaniem i pływający przycisk powrotu do meczu. Plansza: ArenaPage.tsx.
import { api } from '../../api/client';
import { S } from '../../game/store';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import './arena.css';

export interface Hero { id?: number; username: string; bot?: boolean; avatarCard?: string | null; avatarRarity?: string | null; avatarVariant?: string | null }
export interface ChallengeView { id: string; from: Hero; to: Hero; status: string; battle: string | null; left: number }
export interface RewardView { money: number; exp: boolean; pvpWins: number; botWins: number; dailyPvp: number; dailyBot: number; rewardPvp: number; rewardBot: number; note: string | null }
export interface Inbox { incoming: ChallengeView[]; outgoing: ChallengeView | null; battle: { id: string; mode: string } | null; rewards: RewardView }

export const arNav = { go: (path: string) => { location.href = path; } };

const listeners = new Set<(i: Inbox) => void>();
export let inbox: Inbox | null = null;
export const onInbox = (fn: (i: Inbox) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

// ---------------------------------------------------------------- zapisana talia

const DECK_KEY = 'arenaDeck';
export const deckSize = () => S.cfg.arena?.rules?.deckSize ?? 8;

/** Ostatnia talia gracza (tylko karty, które nadal ma) */
export function savedDeck(): string[] {
  let list: string[] = [];
  try { list = JSON.parse(localStorage.getItem(DECK_KEY) || '[]'); } catch { /* brak zapisu */ }
  const mine = new Set(S.items.map(i => i.person));
  return [...new Set(list)].filter(p => mine.has(p) && S.cfg.people[p]);
}

export function saveDeck(deck: string[]) {
  try { localStorage.setItem(DECK_KEY, JSON.stringify(deck)); } catch { /* bez zapisu */ }
}

export const deckReady = (deck = savedDeck()) => deck.length === deckSize();

// ---------------------------------------------------------------- wyzwania

/** Wyzwanie z profilu gracza: z zapisaną talią od razu, bez niej - wybór talii w Arenie */
export async function arChallenge(username: string) {
  const deck = savedDeck();
  if (!deckReady(deck)) {
    toast('Najpierw ułóż talię w Arenie');
    return arNav.go(`/arena?challenge=${encodeURIComponent(username)}`);
  }
  try {
    await api('/api/arena/challenge', { username, deck });
    toast(`Wysłano wyzwanie do: ${username}`);
    check();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

export async function acceptChallenge(id: string, deck = savedDeck()) {
  if (!deckReady(deck)) return arNav.go(`/arena?accept=${encodeURIComponent(id)}`);
  try {
    const r = await api<{ battle: string }>(`/api/arena/challenge/${id}/accept`, { deck });
    closeAsk();
    arNav.go(`/arena?battle=${r.battle}`);
  } catch (e) {
    toast((e as Error).message, true);
  }
}

export async function declineChallenge(id: string) {
  closeAsk();
  await api(`/api/arena/challenge/${id}/decline`, {}).catch(() => {});
  check();
}

// okienko z przychodzącym wyzwaniem (poza Reactem - może przyjść na dowolnej stronie)
const asked = new Set<string>();
function closeAsk() { document.getElementById('arAsk')?.remove(); }

function ask(c: ChallengeView) {
  if (asked.has(c.id) || document.getElementById('arAsk')) return;
  asked.add(c.id);
  Sound.pop();
  const el = document.createElement('div');
  el.id = 'arAsk';
  el.className = 'ar-ask';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Wyzwanie do Areny');
  const name = document.createElement('b');
  name.textContent = c.from.username;
  el.innerHTML = '<p>Wyzwanie do pojedynku w Arenie od </p><div class="ar-ask-btns"><button class="ar-btn ar-btn-hue" data-a="yes">Przyjmij</button><button class="ar-btn" data-a="no">Odrzuć</button></div>';
  el.querySelector('p')!.appendChild(name);
  el.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'yes') acceptChallenge(c.id);
    if (a === 'no') declineChallenge(c.id);
  });
  document.body.appendChild(el);
}

// ---------------------------------------------------------------- pętla

let lastOutgoing = '';
let timer = 0;

async function check() {
  clearTimeout(timer);
  try {
    inbox = await api<Inbox>('/api/arena/inbox');
    listeners.forEach(fn => fn(inbox!));
    const c = inbox.incoming[0];
    if (c && !location.pathname.startsWith('/arena')) ask(c);
    else if (!c) closeAsk();
    const out = inbox.outgoing;
    // moje wyzwanie przyjęte: od razu do meczu
    if (out?.status === 'accepted' && out.battle && lastOutgoing !== out.id + out.battle) {
      lastOutgoing = out.id + out.battle;
      if (!new URLSearchParams(location.search).get('battle')) arNav.go(`/arena?battle=${out.battle}`);
    }
    if (out?.status === 'declined' && lastOutgoing !== out.id + 'd') {
      lastOutgoing = out.id + 'd';
      toast(`${out.to.username} odrzuca wyzwanie`);
    }
    returnButton();
  } catch { /* bez połączenia - spróbujemy później */ }
  timer = window.setTimeout(check, document.hidden ? 20000 : 6000);
}

export function returnButton() {
  let btn = document.getElementById('arReturn') as HTMLButtonElement | null;
  const show = !!inbox?.battle && !location.pathname.startsWith('/arena');
  if (!btn && !show) return;
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'arReturn';
    btn.className = 'ar-return';
    btn.textContent = 'Wróć do meczu';
    btn.addEventListener('click', () => { btn!.hidden = true; arNav.go(`/arena?battle=${inbox?.battle?.id ?? ''}`); });
    document.body.appendChild(btn);
  }
  btn.hidden = !show;
}

let started = false;
export function startArena() {
  if (started || !S.cfg.arena) return;
  started = true;
  check();
}

export const refreshInbox = check;
