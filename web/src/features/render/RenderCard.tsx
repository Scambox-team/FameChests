import { useEffect, useMemo, useRef } from 'react';
import { cardHTML } from '../../cards/cardHtml';
import { S } from '../../game/store';

/** `/render/card?pid=<id>&variant=<wariant>[&w=<px>]`: sama karta na przezroczystym tle, bez paska i okien.
 *  Używa tego bot Discorda: Chromium otwiera stronę na koncie technicznym i robi zrzut elementu `#render-card`,
 *  więc na obrazku jest dokładnie to, co widzi gracz (CSS wariantów, zdjęcie, napisy). Gdy karta i jej zdjęcia są
 *  gotowe, element dostaje `data-ready="1"`. */
export function RenderCard() {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const pid = q.get('pid') ?? '';
  const variant = q.get('variant') || 'normal';
  const width = Math.min(800, Math.max(200, Number(q.get('w')) || 360));
  const box = useRef<HTMLDivElement>(null);
  const known = !!S.cfg.people[pid];
  const html = useMemo(() => (known ? cardHTML(pid, variant, q.get('uid')) : ''), [known, pid, variant, q]);

  useEffect(() => {
    // przezroczyste tło: karta ma zaokrąglone rogi, a obrazek ma je zachować
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    const el = box.current;
    if (!el) return;
    let stop = false;
    (async () => {
      const imgs = [...el.querySelectorAll('img')];
      await Promise.all(imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = () => r(null); })));
      await (document as any).fonts?.ready;
      await new Promise(r => setTimeout(r, 250));   // warstwy CSS (cienie, filtry) dostają chwilę na pierwszy rysunek
      if (!stop) el.dataset.ready = known ? '1' : 'missing';
    })();
    return () => { stop = true; };
  }, [html, known]);

  return (
    // ramka z zapasem na cień karty (zrzut obejmuje #render-frame); szerokość karty ustawia się na samej .card, bo ona
    // sama definiuje --cw (dziedziczenie z rodzica by jej nie zmieniło)
    <div id="render-frame" style={{ display: 'inline-block', padding: 28 }}>
      <style>{`#render-card .card { --cw: ${width}px; }`}</style>
      <div id="render-card" ref={box} style={{ display: 'inline-block' }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
