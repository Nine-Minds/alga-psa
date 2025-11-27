import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@alga-psa/extension-runtime': path.resolve(__dirname, '../../../extension-runtime/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
