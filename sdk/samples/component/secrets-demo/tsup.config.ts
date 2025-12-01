import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/handler.ts'],
  format: ['esm'],
  outDir: 'dist/js',
  clean: true,
  external: ['@alga-psa/extension-runtime'],
  noExternal: [],
});
