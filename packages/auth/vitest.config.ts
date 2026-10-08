import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      // Emulator packages live under packages/emulators/* and are not linked
      // into node_modules; point at their sources like server/vitest.config.ts.
      '@alga-psa/emulator-host': path.resolve(__dirname, '../emulators/host/src/index.ts'),
      '@alga-psa/emulator-msgraph': path.resolve(__dirname, '../emulators/msgraph/src/index.ts'),
      '@alga-psa/client-portal': path.resolve(__dirname, '../client-portal/src'),
      '@alga-psa/documents': path.resolve(__dirname, '../documents/src'),
      '@alga-psa/event-bus': path.resolve(__dirname, '../event-bus/src'),
      '@alga-psa/notifications': path.resolve(__dirname, '../notifications/src'),
      '@alga-psa/ui': path.resolve(__dirname, '../ui/src'),
      '@alga-psa/users': path.resolve(__dirname, '../users/src'),
      '@alga-psa/documents/lib/avatarUtils': path.resolve(__dirname, '../documents/src/lib/avatarUtils.ts'),
      '@alga-psa/documents/actions/documentActions': path.resolve(__dirname, '../documents/src/actions/documentActions.ts'),
      '@alga-psa/client-portal/models/PortalDomainModel': path.resolve(
        __dirname,
        '../client-portal/src/models/PortalDomainModel.ts'
      ),
      '@shared': path.resolve(__dirname, '../../shared'),
      '@ee': path.resolve(__dirname, '../ee/src'),
      '@': path.resolve(__dirname, '../../server/src'),
      'server/src': path.resolve(__dirname, '../../server/src'),
    },
  },
});
