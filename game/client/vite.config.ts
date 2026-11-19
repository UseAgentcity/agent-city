import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const API = 'http://localhost:4317';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 5317,
    proxy: {
      '/api/arena': { target: process.env.ARENA_API ?? 'http://127.0.0.1:5320', changeOrigin: true },
      '/api': { target: API, changeOrigin: true },
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
