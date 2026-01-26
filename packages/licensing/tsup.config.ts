import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib code only
    'index': 'src/index.ts',
    'lib/get-license-usage': 'src/lib/get-license-usage.ts',
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
    '@alga-psa/tenancy',
    '@alga-psa/types',
    '@alga-psa/validation',
    'knex',
  ],
});
