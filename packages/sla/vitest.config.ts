import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@alga-psa/types': path.resolve(__dirname, '../types/src'),
      '@alga-psa/notifications/notifications/email': path.resolve(__dirname, '../notifications/src/notifications/email'),
      '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions': path.resolve(
        __dirname,
        '../notifications/src/actions/internal-notification-actions/internalNotificationActions'
      ),
      '@alga-psa/email': path.resolve(__dirname, '../email/src'),
      '@alga-psa/event-bus/publishers': path.resolve(__dirname, '../event-bus/src/publishers/index.ts'),
    },
  },
});
