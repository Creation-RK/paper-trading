import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode artifact` builds a single self-contained HTML file (no service worker,
// all JS/CSS inlined) that can be hosted anywhere, including a claude.ai artifact.
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    base: './',
    plugins: artifact ? [react(), viteSingleFile()] : [react()],
    define: { __ARTIFACT__: JSON.stringify(artifact) },
    build: {
      outDir: artifact ? 'dist-artifact' : 'dist',
      copyPublicDir: !artifact,
    },
    test: {
      include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    },
  };
});
