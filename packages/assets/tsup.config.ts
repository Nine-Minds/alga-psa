import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib/models code only
    // Actions, components, and hooks are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'models/index': 'src/models/index.ts',
    'lib/schemas/asset.schema': 'src/lib/schemas/asset.schema.ts',
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
    'zod',
    'react',
    'react-dom',
  ],
});
