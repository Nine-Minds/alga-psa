import base from './vitest.no-docker.config';

// The independent-upgrade workflow branch is exercised with mocked workflow/activity
// proxies: no Temporal test server, Docker socket or database is needed.
export default {
  ...base,
  test: {
    ...base.test,
    include: ['src/__tests__/integration/coManagedUpgradeWorkflow.test.ts'],
    exclude: ['**/node_modules/**'],
  },
};
