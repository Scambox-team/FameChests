import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { arNav, arReturnButton, bindArena, renderArena } from './arena';

/** Plansza i talia Areny rysują się same w tym elemencie */
export function ArenaPage() {
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.title = 'Arena · ScamBox';
    arNav.go = navigate;
    bindArena(box.current);
    renderArena();
    arReturnButton();
    return () => {
      document.body.classList.remove('hs-open');
      setTimeout(arReturnButton);   // po zmianie adresu: pływający przycisk powrotu do trwającej walki
    };
  }, [navigate]);
  return <div id="arenaBody" ref={box} />;
}
