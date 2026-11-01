// Zapytania do serwera gry. POST, gdy jest body; serwer odpowiada JSON-em z polem `error` przy błędzie.
type Hook = () => void;
const hooks: { achievements?: Hook; bibi?: Hook } = {};
export const onResponseHeaders = (h: typeof hooks) => Object.assign(hooks, h);

/** Liczba zapytań zmieniających dane w toku: synchronizacja ekwipunku czeka, aż się skończą */
export const net = { inflight: 0, mutations: 0 };

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const post = body !== undefined;
  const opts: RequestInit = post ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  if (post) { net.inflight++; net.mutations++; }
  let res: Response;
  try { res = await fetch(path, opts); } finally { if (post) net.inflight--; }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && data?.login) {
    location.href = '/login';
    throw new Error('Zaloguj się');
  }
  if (res.headers.get('X-Bibi')) hooks.bibi?.();
  if (res.headers.get('X-Ach')) hooks.achievements?.();
  if (!res.ok) throw new Error(data?.error || 'Błąd serwera');
  if (data === null) throw new Error('Błąd połączenia z serwerem, spróbuj jeszcze raz');
  return data as T;
}
