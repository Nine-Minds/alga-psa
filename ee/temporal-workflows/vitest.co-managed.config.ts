import base from './vitest.no-docker.config';

// The suite owns a freshly migrated, disposable database; it does not require a
// Temporal test server because it exercises the activities synchronously.
export default {
  ...base,
  test: {
    ...base.test,
    include: ['src/__tests__/integration/coManagedProvisioning.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    globalSetup: [],
    setupFiles: [],
  },
};
