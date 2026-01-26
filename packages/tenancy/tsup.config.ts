import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib code only
    // Actions, components, server, and client are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'lib/generateBrandingStyles': 'src/lib/generateBrandingStyles.ts',
    'lib/PortalDomainModel': 'src/lib/PortalDomainModel.ts',
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
    '@alga-psa/tenancy',
    '@alga-psa/types',
    '@alga-psa/users',
    '@alga-psa/validation',
    'knex',
  ],
});
