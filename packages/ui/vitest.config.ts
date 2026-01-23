import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
  },
});

