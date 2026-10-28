import { defineConfig } from 'vitest/config';

// Relative base so the built game runs from any folder, including a published artifact.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
});
