import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib/models code only
    // Actions, components, context, and hooks are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'lib/colorUtils': 'src/lib/colorUtils.ts',
    'lib/permissions': 'src/lib/permissions.ts',
    'lib/tagCleanup': 'src/lib/tagCleanup.ts',
    'lib/uiHelpers': 'src/lib/uiHelpers.ts',
    'lib/usersHelpers': 'src/lib/usersHelpers.ts',
    'lib/authHelpers': 'src/lib/authHelpers.ts',
    'models/tagDefinition': 'src/models/tagDefinition.ts',
    'models/tagMapping': 'src/models/tagMapping.ts',
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
    '@alga-psa/documents',
    '@alga-psa/types',
    '@alga-psa/ui',
    '@alga-psa/validation',
    'knex',
    'uuid',
    'react',
    'react-dom',
  ],
});
