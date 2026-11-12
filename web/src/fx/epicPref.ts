// Gracz może wyłączyć wielkie odsłonięcia kart od Legendarnej wzwyż (epicReveal): karta pokazuje się wtedy zwykłym sposobem,
// w tabeli wyników skrzynki albo w oknie gry. Ustawienie jest w Ustawieniach, zapamiętane w przeglądarce.
const KEY = 'epicRevealOff';

export function epicOff() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setEpicOff(off: boolean) {
  try { if (off) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* bez pamięci przeglądarki */ }
}
