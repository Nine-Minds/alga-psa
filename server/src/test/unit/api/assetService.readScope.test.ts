import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import type { ServiceContext } from '@alga-psa/db';
import { compileTenantScopedResourceReadAuthorizationSql } from '@alga-psa/authorization/kernel';
import { AssetService } from '../../../lib/api/services/AssetService';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/authorization/assetReadAuthorization', () => ({
  assetClosedFields: () => [],
  assetColumnsOpenTo: async () => null,
  resolveAuthorizationSubjectForUser: vi.fn(async () => ({
    tenant: 'tenant-1', userId: 'user-1', userType: 'internal',
  })),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => [{
    id: 'rule-1', resource: 'asset', action: 'read', constraintKey: 'unsupported-constraint',
  }]),
}));

vi.mock('@alga-psa/authorization/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/authorization/kernel')>();
  return {
    ...actual,
    compileTenantScopedResourceReadAuthorizationSql: vi.fn(actual.compileTenantScopedResourceReadAuthorizationSql),
  };
});

const db = knexFactory({ client: 'pg' });
const acquireConnection = vi.spyOn(db.client, 'acquireConnection');
const compile = vi.mocked(compileTenantScopedResourceReadAuthorizationSql);
const context: ServiceContext = {
  tenant: 'tenant-1', userId: 'user-1',
  user: { user_id: 'user-1', user_type: 'internal' }, db,
};
const expectedError = 'Unsupported asset read authorization predicate: unsupported bundle constraint unsupported-constraint';

beforeEach(() => {
  compile.mockClear();
  acquireConnection.mockClear();
  acquireConnection.mockRejectedValue(new Error('Unexpected database execution'));
});

afterAll(async () => { await db.destroy(); });

describe('AssetService read authorization compilation', () => {
  it.each(['list', 'search', 'getStatistics'] as const)(
    '%s rejects unsupported predicates before executing any query',
    async (method) => {
      const service = new AssetService();
      const result = method === 'list' ? service.list({}, context)
        : method === 'search' ? service.search({ query: 'laptop' }, context)
        : service.getStatistics(context);

      await expect(result).rejects.toThrow(expectedError);
      expect(compile).toHaveBeenCalledTimes(1);
      expect(acquireConnection).not.toHaveBeenCalled();
    },
  );

  it('rejects an unsupported predicate on the caller query even when the probe succeeded', async () => {
    // Exercise the second guard independently of the initial representability probe.
    compile.mockReturnValueOnce({ supported: true });

    await expect(new AssetService().list({}, context)).rejects.toThrow(expectedError);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(acquireConnection).not.toHaveBeenCalled();
  });
});
