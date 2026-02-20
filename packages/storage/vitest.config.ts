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
    ],
  },
});
