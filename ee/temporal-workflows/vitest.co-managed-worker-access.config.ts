import base from './vitest.co-managed-access.config';

export default {
  ...base,
  resolve: { ...base.resolve, alias: (base.resolve?.alias ?? []).filter(alias =>
    !('replacement' in alias && alias.replacement.endsWith('/stubs/redis.ts'))) },
  test: {
    ...base.test,
    include: ['src/__tests__/worker-access/coManagedBuiltWorkerAccess.integration.test.ts'],
  },
};
