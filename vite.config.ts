import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built game also works from file:// or inside Tauri/Electron.
  base: './',
  server: { port: 5173, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
