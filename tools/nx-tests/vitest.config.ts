import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tools/nx-tests/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    isolate: true,
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
  },
});
