// JEDNO źródło prawdy o menu panelu admina. Nowy panel = dopisać pozycję tutaj (+ `data-sec="<id>"` w panel.html albo stronę w AdminApp.tsx).
// kind 'panel': element(y) z `data-sec="<id>"` w panel.html, adres `/admin#<id>`; kind 'page': osobna strona pod `path`.

export type AdminItem = { id: string; label: string; desc: string; kind: 'panel' | 'page'; path?: string; owner?: boolean };
export type AdminGroup = { id: string; label: string; items: AdminItem[] };

const P = (id: string, label: string, desc: string): AdminItem => ({ id, label, desc, kind: 'panel' });
const G = (id: string, label: string, desc: string, path: string, owner?: boolean): AdminItem => ({ id, label, desc, kind: 'page', path, owner });

export const ADMIN_GROUPS: AdminGroup[] = [
  { id: 'katalog', label: 'Katalog', items: [
    P('skrzynki', 'Skrzynki', 'Skrzynki w sklepie, ich ustawienia i karty'),
    P('karty', 'Karty', 'Wyszukiwarka wszystkich kart, nowa karta, eksport wyników'),
    P('import', 'Import i eksport kart', 'Dodawanie i zmiana wielu kart z pliku JSON / CSV, wzory plików'),
    G('warianty', 'Warianty', 'Wyglądy kart, gdzie wypadają, wydarzenia', '/variants'),
    G('naklejki', 'Naklejki', 'Naklejki na kartach', '/stickers'),
    G('kreator', 'Kreator wariantów', 'Tworzenie własnych wariantów kart', '/designer'),
    G('specjalne', 'Karty specjalne', 'Wszystkie karty specjalne i ich wyglądy', '/mockups'),
    P('linki', 'Linki do kart specjalnych', 'Adresy, po których gracz dostaje kartę specjalną'),
  ] },
  { id: 'gracze', label: 'Gracze', items: [
    P('gracze', 'Gracze', 'Lista graczy, saldo, blokady, ekwipunek'),
    P('dziennik', 'Dziennik adminów', 'Co i kiedy zmienili admini'),
    G('zgloszenia', 'Zgłoszenia', 'Zgłoszenia od graczy', '/admin/reports'),
    G('polecenia', 'Polecenia', 'Kody polecające i nagrody za zaproszenia', '/admin/referrals'),
  ] },
  { id: 'tresci', label: 'Treści', items: [
    P('wiadomosci', 'Wiadomości do graczy', 'Okienka z komunikatem, planowane na wybrany czas'),
    P('maile', 'Maile', 'Edytor szablonów maili z podglądem na żywo: reset hasła, zmiana emaila, potwierdzenie konta'),
    P('osiagniecia', 'Osiągnięcia', 'Warunki i nagrody osiągnięć'),
    P('questy', 'Questy', 'Codzienny cel: karta do zdobycia'),
    G('eventy', 'Eventy', 'Wydarzenia w grze', '/admin/events'),
    P('easter', 'Easter egg', 'Obrazek przelatujący w bębnie skrzynki'),
  ] },
  { id: 'gry', label: 'Gry', items: [
    G('gry', 'Gry', 'Ustawienia gier i kasyna', '/admin/games'),
    G('szachy', 'Szachy', 'Skrzynki szachów i skiny figur', '/admin/chess'),
    P('skiny', 'Skiny figur', 'Rzadkości i dostępność skinów do szachów'),
    P('konie', 'Wyścigi konne', 'Nazwy koni i mnożniki wygranej'),
  ] },
  { id: 'system', label: 'System', items: [
    G('kopie', 'Kopie zapasowe', 'Kopie bazy i plików (tylko właściciel)', '/admin/backups', true),
  ] },
];

// stare adresy działów (#crates...) -> pierwsza pozycja grupy
export const LEGACY_HASH: Record<string, string> = { crates: 'skrzynki', cards: 'karty', players: 'gracze', content: 'wiadomosci', games: 'gry' };

export const allItems = (owner: boolean) => ADMIN_GROUPS.flatMap(g => g.items.filter(i => owner || !i.owner).map(i => ({ ...i, group: g.label })));
export const itemHref = (i: AdminItem) => i.kind === 'panel' ? `/admin#${i.id}` : i.path!;
export const PANEL_IDS = ADMIN_GROUPS.flatMap(g => g.items).filter(i => i.kind === 'panel').map(i => i.id);
export const ITEM_KEY = 'adminItem';
