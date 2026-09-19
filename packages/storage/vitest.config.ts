import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    conditions: ['types', 'import', 'module', 'default'],
    alias: [
      // Workspace packages whose exports map points "import" to ./dist (unbuilt).
      // Redirect to source so vitest can resolve them before vi.mock kicks in.
      // LEVERAGE: pattern vitest-workspace-src-aliases — same hand-transcribed
      // copy of @alga-psa/db's exports map as 18 other vitest configs.
      // "./admin" lives at src/lib/admin.ts, so it must precede the catch-all
      // below, which would rewrite it to the nonexistent src/admin. StorageService
      // reaches it through @alga-psa/licensing's built lib/license-state.js.
      { find: /^@alga-psa\/db\/admin$/, replacement: path.resolve(__dirname, '../db/src/lib/admin.ts') },
      { find: /^@alga-psa\/db(.*)$/, replacement: path.resolve(__dirname, '../db/src$1') },
      { find: /^@alga-psa\/event-bus(.*)$/, replacement: path.resolve(__dirname, '../event-bus/src$1') },
      { find: /^@alga-psa\/event-schemas(.*)$/, replacement: path.resolve(__dirname, '../event-schemas/src$1') },
      { find: /^@alga-psa\/workflows(.*)$/, replacement: path.resolve(__dirname, '../../ee/packages/workflows/src$1') },
      { find: /^@alga-psa\/auth(.*)$/, replacement: path.resolve(__dirname, '../auth/src$1') },
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },
      { find: /^@alga-psa\/core\/(.*)$/, replacement: path.resolve(__dirname, '../core/src/lib/$1') },
      { find: /^@alga-psa\/validation(.*)$/, replacement: path.resolve(__dirname, '../validation/src$1') },
    ],
  },
});
