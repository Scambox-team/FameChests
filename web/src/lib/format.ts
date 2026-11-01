export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Waluta gry to grosze */
export const fmt = (n: number) => Math.round(n).toLocaleString('pl-PL') + ' gr';
export const fmtNum = (n: number) => Math.round(n).toLocaleString('pl-PL');
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
