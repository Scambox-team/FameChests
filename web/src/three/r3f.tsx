// Wspólny gospodarz scen 3D na React Three Fiber: R3F tworzy renderer, pilnuje rozmiaru i pętli renderowania
// (useFrame), a każda scena z `three/*Scene.ts` dostaje gotowy `gl` i podaje tylko swoją funkcję klatki.
// Używamy `createRoot` z R3F, bo sceny są tworzone z kodu na już istniejącym <canvas> (podgląd, nakładki, tło kasyna).
import { createRoot, useFrame } from '@react-three/fiber';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export interface R3FHost {
  /** renderer utworzony przez R3F (ACES tone mapping jest domyślnie włączony) */
  gl: WebGLRenderer;
  /** funkcja klatki sceny: wołana przed każdym renderem, `now` w ms jak z requestAnimationFrame */
  run(frame: (now: number) => void): void;
  /** zmiana rozmiaru canvasu (po tym jak R3F ustawił już rozmiar renderera) */
  onResize(cb: () => void): void;
  dispose(): void;
}

function Ticker({ frame }: { frame: { current: ((now: number) => void) | null } }) {
  useFrame(() => frame.current?.(performance.now()));
  return null;
}

export function mountR3F(canvas: HTMLCanvasElement, o: { scene: Scene; camera: PerspectiveCamera; alpha?: boolean; maxDpr?: number; exposure?: number }): R3FHost {
  const frame: { current: ((now: number) => void) | null } = { current: null };
  const resized: (() => void)[] = [];
  const root = createRoot(canvas);
  // kamerą rządzi scena (kadr, setViewOffset, fov), R3F ma jej nie przestawiać po zmianie rozmiaru
  (o.camera as PerspectiveCamera & { manual?: boolean }).manual = true;
  // configure() trzeba wołać z całym zestawem ustawień: brakujące pola wracają do domyślnych (kamera, dpr, pętla)
  const cfg = {
    gl: { alpha: o.alpha ?? true, antialias: true },
    dpr: Math.min(devicePixelRatio, o.maxDpr ?? 2),
    scene: o.scene,
    camera: o.camera,
    frameloop: 'always' as 'always' | 'never',
    size: { width: 1, height: 1, top: 0, left: 0 }
  };
  const apply = () => { void root.configure(cfg); canvas.style.width = canvas.style.height = ''; };
  const measure = () => {
    const r = canvas.getBoundingClientRect();
    cfg.size = { width: Math.round(r.width) || 1, height: Math.round(r.height) || 1, top: r.top, left: r.left };
  };
  measure(); apply();
  // renderer WebGL powstaje od razu, więc render() zwraca już działającą scenę
  const store = root.render(<Ticker frame={frame} />);
  const gl = store.getState().gl;
  gl.toneMappingExposure = o.exposure ?? 1.05;

  // R3F nadaje płótnu rozmiar w pikselach; rozmiar ma zostać w CSS, jak przy setSize(W, H, false)
  const ro = new ResizeObserver(() => { measure(); apply(); resized.forEach(cb => cb()); }); ro.observe(canvas);
  // poza ekranem nie renderujemy (R3F zatrzymuje pętlę)
  const io = new IntersectionObserver(([e]) => { cfg.frameloop = e.isIntersecting ? 'always' : 'never'; apply(); });
  io.observe(canvas);

  return {
    gl,
    run(f) { frame.current = f; },
    onResize(cb) { resized.push(cb); },
    dispose() { frame.current = null; ro.disconnect(); io.disconnect(); root.unmount(); }
  };
}
