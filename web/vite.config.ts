import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, '.'),
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: resolve(import.meta.dirname, '..', 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        '404': resolve(import.meta.dirname, '404.html'),
        '410': resolve(import.meta.dirname, '410.html'),
        '503': resolve(import.meta.dirname, '503.html'),
      },
    },
  },
});
