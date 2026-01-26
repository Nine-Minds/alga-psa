import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'schemas/index': 'src/schemas/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: false,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    'zod',
  ],
});
