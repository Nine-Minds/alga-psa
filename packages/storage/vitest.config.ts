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
