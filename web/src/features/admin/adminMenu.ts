// JEDNO źródło prawdy o menu panelu admina. Nowy panel = dopisać pozycję tutaj (+ `data-sec="<id>"` w panel.html albo stronę w AdminApp.tsx).
// kind 'panel': element(y) z `data-sec="<id>"` w panel.html, adres `/admin#<id>`; kind 'page': osobna strona pod `path`.
// perm: uprawnienie rangi (klucze jak `PERMS` w server/src/routes/roles.rs); owner: tylko właściciel.

export type AdminItem = { id: string; label: string; desc: string; kind: 'panel' | 'page'; path?: string; owner?: boolean; perm?: string };
export type AdminGroup = { id: string; label: string; items: AdminItem[] };

const P = (id: string, label: string, desc: string, perm: string): AdminItem => ({ id, label, desc, kind: 'panel', perm });
const G = (id: string, label: string, desc: string, path: string, perm?: string, owner?: boolean): AdminItem => ({ id, label, desc, kind: 'page', path, perm, owner });

export const ADMIN_GROUPS: AdminGroup[] = [
  { id: 'katalog', label: 'Katalog', items: [
    P('skrzynki', 'Skrzynki', 'Skrzynki w sklepie, ich ustawienia i karty', 'catalog'),
    P('karty', 'Karty', 'Wyszukiwarka wszystkich kart, nowa karta, eksport wyników', 'catalog'),
    P('import', 'Import i eksport kart', 'Dodawanie i zmiana wielu kart z pliku JSON / CSV, wzory plików', 'catalog'),
    G('warianty', 'Warianty', 'Wyglądy kart, gdzie wypadają, wydarzenia', '/variants', 'catalog'),
    G('naklejki', 'Naklejki', 'Naklejki na kartach', '/stickers', 'catalog'),
    G('kreator', 'Kreator wariantów', 'Tworzenie własnych wariantów kart', '/designer', 'catalog'),
    G('specjalne', 'Karty specjalne', 'Wszystkie karty specjalne i ich wyglądy', '/mockups', 'catalog'),
    P('linki', 'Linki do kart specjalnych', 'Adresy, po których gracz dostaje kartę specjalną', 'content'),
  ] },
  { id: 'gracze', label: 'Gracze', items: [
    P('gracze', 'Gracze', 'Lista graczy, saldo, blokady, ekwipunek', 'users'),
    P('dziennik', 'Dziennik adminów', 'Co i kiedy zmienili admini', 'log'),
    G('zgloszenia', 'Zgłoszenia', 'Zgłoszenia od graczy', '/admin/reports', 'reports'),
    G('polecenia', 'Polecenia', 'Kody polecające i nagrody za zaproszenia', '/admin/referrals', 'content'),
  ] },
  { id: 'tresci', label: 'Treści', items: [
    P('wiadomosci', 'Wiadomości do graczy', 'Okienka z komunikatem, planowane na wybrany czas', 'content'),
    P('maile', 'Maile', 'Edytor szablonów maili z podglądem na żywo: reset hasła, zmiana emaila, potwierdzenie konta', 'content'),
    P('osiagniecia', 'Osiągnięcia', 'Warunki i nagrody osiągnięć', 'content'),
    P('questy', 'Questy', 'Codzienny cel: karta do zdobycia i zadanie CTF', 'content'),
    G('eventy', 'Eventy', 'Wydarzenia w grze', '/admin/events', 'content'),
    P('easter', 'Easter egg', 'Obrazek przelatujący w bębnie skrzynki', 'content'),
    G('motywy', 'Motywy', 'Dostępność motywu Niepodległość: terminy, na stałe, wyłączony', '/admin/themes', 'content'),
    G('radio', 'Radio', 'Albumy i utwory do funkcji eksperymentalnej Radio: nazwy, źródła, kolejność', '/admin/radio', 'content'),
  ] },
  { id: 'gry', label: 'Gry', items: [
    G('gry', 'Gry', 'Ustawienia gier i kasyna', '/admin/games', 'games'),
    G('szachy', 'Szachy', 'Skrzynki szachów i skiny figur', '/admin/chess', 'games'),
    P('skiny', 'Skiny figur', 'Rzadkości i dostępność skinów do szachów', 'games'),
    P('konie', 'Wyścigi konne', 'Nazwy koni i mnożniki wygranej', 'games'),
  ] },
  { id: 'system', label: 'System', items: [
    G('rangi', 'Rangi', 'Rangi adminów i ich uprawnienia (tylko właściciel)', '/admin/roles', undefined, true),
    G('kopie', 'Kopie zapasowe', 'Kopie bazy i plików (tylko właściciel)', '/admin/backups', undefined, true),
  ] },
];

// stare adresy działów (#crates...) -> pierwsza pozycja grupy
export const LEGACY_HASH: Record<string, string> = { crates: 'skrzynki', cards: 'karty', players: 'gracze', content: 'wiadomosci', games: 'gry' };

/** Pozycje widoczne dla admina: właściciel widzi wszystko, reszta tylko to, na co pozwala ranga (`perms` = null: jeszcze nie wiadomo, bez ograniczeń) */
export const allItems = (owner: boolean, perms: string[] | null = null) =>
  ADMIN_GROUPS.flatMap(g => g.items
    .filter(i => owner || (!i.owner && (!i.perm || !perms || perms.includes(i.perm))))
    .map(i => ({ ...i, group: g.label })));
export const itemHref = (i: AdminItem) => i.kind === 'panel' ? `/admin#${i.id}` : i.path!;
export const PANEL_IDS = ADMIN_GROUPS.flatMap(g => g.items).filter(i => i.kind === 'panel').map(i => i.id);
export const ITEM_KEY = 'adminItem';
