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
      // Resolve to source so tests see user-type predicates without a rebuilt dist.
      '@alga-psa/types': path.resolve(__dirname, '../types/src'),
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
      // The tenant-discovery engine loads these lazily (they import @alga-psa/auth); resolve to source so tests need no built dist.
      '@alga-psa/tenancy/server': path.resolve(__dirname, '../tenancy/src/server.ts'),
      '@alga-psa/email': path.resolve(__dirname, '../email/src/index.ts'),
      '@alga-psa/shared': path.resolve(__dirname, '../../shared'),
      '@shared': path.resolve(__dirname, '../../shared'),
      '@ee': path.resolve(__dirname, '../ee/src'),
      '@': path.resolve(__dirname, '../../server/src'),
      'server/src': path.resolve(__dirname, '../../server/src'),
    },
  },
});
