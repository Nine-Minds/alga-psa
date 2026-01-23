import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
  },
});

