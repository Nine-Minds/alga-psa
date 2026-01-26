import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'events': 'src/events.ts',
    'publishers/index': 'src/publishers/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    '@alga-psa/core',
    '@alga-psa/event-schemas',
    '@alga-psa/types',
    'redis',
    'uuid',
    'zod',
  ],
});
