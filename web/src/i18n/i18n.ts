// Język gry. Kod i dane są po polsku; wersja angielska tłumaczy to, co widać na stronie: teksty, title / placeholder /
// aria-label, tytuł karty przeglądarki i okienka confirm/alert. Słownik (`en/*.ts`, polski tekst -> angielski) wczytuje się
// tylko po wybraniu angielskiego. Klucz z {0}, {1}... to szablon: te miejsca łapią dowolny tekst, który też tłumaczymy.
// Nowy tekst w grze = dopisać go do słownika (inaczej zostanie po polsku).

export type Lang = 'pl' | 'en';
const KEY = 'lang';

export const lang: Lang = (() => { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'pl'; } catch { return 'pl'; } })();

/** Zmiana języka: zapis i przeładowanie strony (przy powrocie na polski nie trzeba odtwarzać oryginałów) */
export function setLang(l: Lang) {
  if (l === lang) return;
  try { localStorage.setItem(KEY, l); } catch { /* bez zapamiętania */ }
  location.reload();
}

type Pattern = { re: RegExp; order: number[]; out: string; lit: number };
const exact = new Map<string, string>();
const byWord = new Map<string, Pattern[]>();
const loose: Pattern[] = [];
const cache = new Map<string, string | null>();

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (s: string) => s.toLowerCase().match(/[\p{L}]{3,}/gu) ?? [];

function compile(dict: Record<string, string>) {
  for (const [k0, v] of Object.entries(dict)) {
    const k = norm(k0);
    if (!/\{\d+\}/.test(k)) { exact.set(k, v); continue; }
    const order: number[] = [];
    const src = k.split(/(\{\d+\})/).map(p => {
      const m = p.match(/^\{(\d+)\}$/);
      if (m) { order.push(+m[1]); return '(.+?)'; }
      return esc(p);
    }).join('');
    const lit = k.replace(/\{\d+\}/g, '');
    const p: Pattern = { re: new RegExp(`^${src}$`, 's'), order, out: v, lit: lit.length };
    // wzorzec sprawdzamy tylko dla tekstów, w których jest jego najdłuższe słowo
    const w = words(lit).sort((a, b) => b.length - a.length)[0];
    if (w) { if (!byWord.has(w)) byWord.set(w, []); byWord.get(w)!.push(p); } else loose.push(p);
  }
  for (const list of byWord.values()) list.sort((a, b) => b.lit - a.lit);
  loose.sort((a, b) => b.lit - a.lit);
}

/** Tłumaczenie jednego tekstu (null = nie ma w słowniku) */
export function tr(s0: string, depth = 0): string | null {
  const s = norm(s0);
  if (!s || !/\p{L}/u.test(s)) return null;
  const hit = exact.get(s);
  if (hit !== undefined) return hit;
  if (cache.has(s)) return cache.get(s)!;
  let res: string | null = null;
  if (depth < 4) {
    const seen = new Set<Pattern>();
    const cands = [...new Set(words(s))].flatMap(w => byWord.get(w) ?? []).concat(loose).filter(p => !seen.has(p) && seen.add(p)).sort((a, b) => b.lit - a.lit);
    for (const p of cands) {
      const m = s.match(p.re);
      if (!m) continue;
      res = p.out.replace(/\{(\d+)\}/g, (_, i) => {
        const val = m[p.order.indexOf(+i) + 1] ?? '';
        return tr(val, depth + 1) ?? val;
      });
      break;
    }
  }
  if (cache.size > 20000) cache.clear();
  cache.set(s, res);
  return res;
}

// ------------------------------------------------------------------ tłumaczenie strony
const ATTRS = ['title', 'placeholder', 'aria-label'];
const SKIP = 'script, style, textarea, code, [contenteditable], .no-i18n';
const done = new WeakMap<Node, string>();

function textNode(n: Text) {
  const v = n.nodeValue ?? '';
  if (done.get(n) === v || !/\p{L}/u.test(v)) return;
  const p = n.parentElement;
  if (!p || p.closest(SKIP)) return;
  const t = tr(v);
  if (t == null) return;
  const m = v.match(/^(\s*)[\s\S]*?(\s*)$/)!;
  const out = m[1] + t + m[2];
  done.set(n, out);
  if (out !== v) n.nodeValue = out;
}

function attrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const t = tr(v);
    if (t != null && t !== v) el.setAttribute(a, t);
  }
}

function walk(root: Node) {
  if (root.nodeType === 3) return textNode(root as Text);
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) {
    if ((root as Element).matches(SKIP)) return;
    attrs(root as Element);
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => n.nodeType === 1 && (n as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) textNode(n as Text); else attrs(n as Element);
  }
}

function title() {
  const t = tr(document.title);
  if (t != null && t !== document.title) document.title = t;
}

/** Włącza angielski: wczytuje słownik i tłumaczy stronę teraz i przy każdej zmianie DOM-u */
export async function startI18n() {
  if (lang !== 'en') return;
  document.documentElement.lang = 'en';
  const { EN } = await import('./en');
  compile(EN);
  // okienka przeglądarki
  for (const name of ['alert', 'confirm', 'prompt'] as const) {
    const orig = window[name].bind(window) as (msg?: string, ...rest: unknown[]) => unknown;
    (window as any)[name] = (msg?: string, ...rest: unknown[]) => orig(msg != null ? tr(String(msg)) ?? msg : msg, ...rest);
  }
  // daty po angielsku (napisy z liczbami tłumaczy słownik)
  for (const fn of ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'] as const) {
    const orig = Date.prototype[fn];
    (Date.prototype as any)[fn] = function (this: Date, loc?: string | string[], opts?: Intl.DateTimeFormatOptions) {
      return orig.call(this, loc === 'pl-PL' || loc == null ? 'en-GB' : loc, opts);
    };
  }
  walk(document.body);
  title();
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') textNode(m.target as Text);
      else if (m.type === 'attributes') attrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  new MutationObserver(title).observe(document.head, { subtree: true, childList: true, characterData: true });
}
