import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/jolt-physics')) return 'jolt';
        },
      },
    },
  },
});
