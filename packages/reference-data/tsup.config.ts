import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable models code only
    // Actions and components are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'models/priority': 'src/models/priority.ts',
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
    '@alga-psa/db',
    '@alga-psa/shared',
    '@alga-psa/types',
    '@alga-psa/ui',
    '@alga-psa/validation',
    'knex',
  ],
});
