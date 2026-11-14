import base from './vitest.co-managed-access.config';

// L6a2 DB-backed proof: shared time/billing journey, Ticket Quick Invoice and capability neutrality over
// a relationship bootstrapped through the real L1a provisioning path (see coManagedBootstrap.integration.test.ts).
export default {
  ...base,
  test: { ...base.test, include: ['src/__tests__/integration/coManagedBootstrap.integration.test.ts'], testTimeout: 120000, hookTimeout: 600000 },
};
