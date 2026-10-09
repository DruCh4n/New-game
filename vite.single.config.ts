import { defineConfig } from 'vite';

/** Builds everything (code, styles, bundled maps) into one JS chunk; see scripts/build-single.ts. */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist-single/tmp',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
