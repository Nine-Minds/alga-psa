import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts'],
  format: ['esm'],
  dts: false,
  bundle: false,
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
});
