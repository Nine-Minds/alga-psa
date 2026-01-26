import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib code only
    // Actions, components, hooks, and services with missing deps are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'lib/avatarUtils': 'src/lib/avatarUtils.ts',
    'lib/permissions': 'src/lib/permissions.ts',
    'lib/rateLimiting': 'src/lib/rateLimiting.ts',
    'lib/roleActions': 'src/lib/roleActions.ts',
    // Note: UserService is runtime-only due to missing schemas/userSchemas
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
