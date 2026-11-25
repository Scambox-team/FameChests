import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Adresy obsługiwane przez serwer gry (Rust); w trybie dev przechodzą przez proxy
const SERVER = process.env.GAME_SERVER ?? 'http://127.0.0.1:5002';
const proxied = ['/api', '/img', '/static', '/flag', '/drawing', '/sticker', '/gsticker', '/cosmetic', '/avatar', '/egg', '/radio', '/ctf', '/sw.js', '/manifest.webmanifest'];

// Tryb wydajności (src/fx/perf.ts): każda reguła z `@media (prefers-reduced-motion: reduce)` dostaje kopię pod
// `:root[data-lite]`, więc przełącznik w grze działa tak samo jak systemowe „ogranicz ruch” - bez pisania reguł dwa razy.
const REDUCED = /^\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/;
const liteSelector = (s: string) => {
  if (s.startsWith(':root')) return s.replace(/^:root/, ':root[data-lite]');
  if (/^html\b/.test(s)) return s.replace(/^html/, 'html[data-lite]');
  return `:root[data-lite] ${s}`;
};
const liteMotion = {
  postcssPlugin: 'lite-motion',
  OnceExit(root: any) {
    root.walkAtRules('media', (at: any) => {
      if (!REDUCED.test(at.params.trim())) return;
      const copies: any[] = [];
      at.each((node: any) => {
        if (node.type !== 'rule') return;   // np. @keyframes w środku zostają tylko dla systemowego ustawienia
        const c = node.clone();
        c.selectors = node.selectors.map(liteSelector);
        copies.push(c);
      });
      if (copies.length) at.after(copies);
    });
  }
};

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/app/' : '/',   // serwer podaje zbudowane pliki pod /app/
  plugins: [react()],
  css: { postcss: { plugins: [liteMotion] } },
  server: {
    port: 5173,
    proxy: Object.fromEntries(proxied.map(p => [p, { target: SERVER, changeOrigin: false }]))
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 }
}));
