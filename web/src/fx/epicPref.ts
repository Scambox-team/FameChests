// Gracz może wyłączyć wielkie odsłonięcia kart od Legendarnej wzwyż (epicReveal): karta pokazuje się wtedy zwykłym sposobem,
// w tabeli wyników skrzynki albo w oknie gry. Ustawienie jest w Ustawieniach, zapamiętane w przeglądarce.
const KEY = 'epicRevealOff';

// Konfetti przy otwieraniu skrzynek (odsłonięcia kart, tabela wyników, drukarka paragonu): osobny wyłącznik, bo bywa męczące
const CONFETTI_KEY = 'crateConfettiOff';
export function confettiOff() {
  try { return localStorage.getItem(CONFETTI_KEY) === '1'; } catch { return false; }
}
export function setConfettiOff(off: boolean) {
  try { if (off) localStorage.setItem(CONFETTI_KEY, '1'); else localStorage.removeItem(CONFETTI_KEY); } catch { /* bez pamięci przeglądarki */ }
}

export function epicOff() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setEpicOff(off: boolean) {
  try { if (off) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* bez pamięci przeglądarki */ }
}
