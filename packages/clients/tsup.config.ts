import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable code only - NO 'use server' or 'use client' directives
    // Actions, components, and hooks are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    // Models
    'models/index': 'src/models/index.ts',
    'models/client': 'src/models/client.ts',
    'models/clientContract': 'src/models/clientContract.ts',
    'models/clientContractLine': 'src/models/clientContractLine.ts',
    'models/interactions': 'src/models/interactions.ts',
    // Schemas
    'schemas/index': 'src/schemas/index.ts',
    'schemas/client.schema': 'src/schemas/client.schema.ts',
    // Lib utilities (buildable only)
    'lib/clientContractWorkflowEvents': 'src/lib/clientContractWorkflowEvents.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    // All @alga-psa packages should be external (resolved at runtime)
    /^@alga-psa\/.*/,
    'knex',
    'uuid',
    'zod',
    'react',
    'react-dom',
    '@js-temporal/polyfill',
  ],
});
