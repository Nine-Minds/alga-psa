import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib/services code only
    // Actions, components, and hooks are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'lib/avatarUtils': 'src/lib/avatarUtils.ts',
    'lib/permissions': 'src/lib/permissions.ts',
    'lib/rateLimiting': 'src/lib/rateLimiting.ts',
    'lib/roleActions': 'src/lib/roleActions.ts',
    'services/UserService': 'src/services/UserService.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    '@alga-psa/auth',
    '@alga-psa/core',
    '@alga-psa/db',
    '@alga-psa/media',
    '@alga-psa/teams',
    '@alga-psa/types',
    '@alga-psa/ui',
    '@alga-psa/validation',
    'knex',
  ],
});
