import base from './vitest.no-docker.config';
import path from 'node:path';

// The suite owns a freshly migrated, disposable database; it does not require a
// Temporal test server because it exercises the activities synchronously.
export default {
  ...base,
  resolve: { ...base.resolve, alias: [
    { find: '@alga-psa/teams/models/team', replacement: path.resolve(__dirname, '../../packages/teams/src/models/team.ts') },
    { find: '@alga-psa/ui/lib/errorHandling', replacement: path.resolve(__dirname, '../../packages/ui/src/lib/errorHandling.ts') },
    ...(base.resolve?.alias ?? []),
  ] },
  test: {
    ...base.test,
    include: ['src/__tests__/integration/coManagedProvisioning.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    globalSetup: [],
    setupFiles: [],
  },
};
