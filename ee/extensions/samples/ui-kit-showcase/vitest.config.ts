import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, 'test/setup.ts')],
  },
  resolve: {
    alias: {
      '@alga/ui-kit': path.resolve(__dirname, '..', '..', 'server', 'packages', 'ui-kit', 'src'),
    },
  },
});
