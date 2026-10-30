import { defineConfig } from 'vite';

export default defineConfig({
  // satellite.js ships an optional WASM build that uses top-level await; ES workers support it.
  worker: { format: 'es' },
});
