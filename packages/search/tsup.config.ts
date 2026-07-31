import { defineConfig } from 'tsup';

// One self-contained file per subpath export so the package's exports map
// (., ./acl, ./normalize, ./query, ./runAppSearch, ./sql, ./upsert,
// ./indexers, ./indexers/*, ./actions/searchActionShared) resolves to matching
// dist/ files. Each entry is bundled (internal relative imports inlined) so the
// emitted .mjs/.js is valid Node ESM/CJS without extension rewriting, while
// every @alga-psa/* and @shared/* package stays external — those are resolved
// from node_modules at runtime (the temporal worker and the Next.js server both
// provide them).
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/acl.ts',
    'src/normalize.ts',
    'src/query.ts',
    'src/runAppSearch.ts',
    'src/sql.ts',
    'src/upsert.ts',
    'src/indexers/index.ts',
    'src/indexers/*.ts',
    'src/actions/searchActionShared.ts',
    '!src/**/*.test.ts',
    '!src/**/*.test.tsx',
    '!src/**/__tests__/**',
  ],
  format: ['esm', 'cjs'],
  dts: false,
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    /^@alga-psa\//,
    /^@shared\//,
    'knex',
    'zod',
  ],
});
