import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Adresy obsługiwane przez serwer gry (Rust); w trybie dev przechodzą przez proxy
const SERVER = process.env.GAME_SERVER ?? 'http://127.0.0.1:5002';
const proxied = ['/api', '/img', '/static', '/flag', '/drawing', '/sticker', '/avatar', '/egg', '/ctf', '/sw.js', '/manifest.webmanifest'];

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/app/' : '/',   // serwer podaje zbudowane pliki pod /app/
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(proxied.map(p => [p, { target: SERVER, changeOrigin: false }]))
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 }
}));
