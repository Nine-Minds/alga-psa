import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable models code only
    // Actions and hooks are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'models/team': 'src/models/team.ts',
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
    '@alga-psa/types',
    '@alga-psa/validation',
    'knex',
    'uuid',
  ],
});
