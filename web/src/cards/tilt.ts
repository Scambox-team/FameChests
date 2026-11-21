// Przechył karty za kursorem: zmienne CSS --rx / --ry (obrót) i --mx / --my (połysk, warstwy wariantów). Wspólne dla <Card> i podglądu karty.
export function tiltMove(el: HTMLElement | null, e: { clientX: number; clientY: number; pointerType?: string }, max = 16) {
  if (!el || e.pointerType === 'touch') return;
  const b = el.getBoundingClientRect();
  if (!b.width || !b.height) return;
  const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
  el.classList.add('tilting');
  el.style.setProperty('--ry', `${(x - .5) * max}deg`);
  el.style.setProperty('--rx', `${(.5 - y) * max}deg`);
  el.style.setProperty('--mx', `${x * 100}%`);
  el.style.setProperty('--my', `${y * 100}%`);
}

export function tiltLeave(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove('tilting');
  el.style.setProperty('--rx', '0deg');
  el.style.setProperty('--ry', '0deg');
}
