import base from './vitest.co-managed-access.config';

// L2 DB-backed proof: the real shared-work entry points against a freshly migrated
// disposable database (see coManagedSharedWork.integration.test.ts).
export default {
  ...base,
  test: { ...base.test, include: ['src/__tests__/integration/coManagedSharedWork.integration.test.ts'], testTimeout: 120000, hookTimeout: 600000 },
};
