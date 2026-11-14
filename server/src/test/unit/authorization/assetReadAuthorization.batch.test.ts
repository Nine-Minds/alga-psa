import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const state = vi.hoisted(() => ({
  associations: [] as Array<{ asset_id: string; entity_type: string; entity_id: string; created_at: string | null }>,
  lookups: [] as string[][],
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => ({
      whereIn: (_column: string, ids: string[]) => {
        const ordering: Array<{ column: 'created_at' | 'entity_id'; direction: 'asc' | 'desc' }> = [];
        const query = {
          orderBy(column: 'created_at' | 'entity_id', direction: 'asc' | 'desc') {
            ordering.push({ column, direction });
            return query;
          },
          select: async () => {
            state.lookups.push(ids);
            const rows = state.associations.filter((row) => ids.includes(row.asset_id));
            // Different underlying row order must not change an explicitly ordered result.
            if (ids.length > 1) rows.reverse();
            return rows.sort((a, b) => {
              for (const { column, direction } of ordering) {
                const left = a[column];
                const right = b[column];
                const comparison = left === right ? 0 : left === null ? 1 : right === null ? -1 : left < right ? -1 : 1;
                if (comparison) return direction === 'asc' ? comparison : -comparison;
              }
              return 0;
            });
          },
        };
        return query;
      },
    }),
  }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

import {
  filterReadableAssets,
  isAssetActionAllowed,
  isAssetReadAllowed,
} from '@alga-psa/authorization/assetReadAuthorization';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
} from '@alga-psa/authorization/kernel';

const db = {} as Knex;
const assets = [
  { asset_id: 'multi-user', client_id: 'client-a' },
  { asset_id: 'single-user', client_id: 'client-a' },
];

function context() {
  return {
    subject: { tenant: 'tenant-a', userId: 'owner', userType: 'internal' as const },
    authorizationKernel: createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: async () => (['read', 'update', 'delete'] as const).map((action) => ({
          id: `own-${action}`, resource: 'asset', action, templateKey: 'own' as const,
        })),
      }),
      rbacEvaluator: async () => true,
    }),
    requestCache: new RequestLocalAuthorizationCache(),
  };
}

describe('batched asset read authorization', () => {
  beforeEach(() => {
    state.lookups = [];
    state.associations = [
      { asset_id: 'multi-user', entity_type: 'user', entity_id: 'owner', created_at: '2026-10-30' },
      { asset_id: 'multi-user', entity_type: 'user', entity_id: 'other', created_at: '2026-10-31' },
      { asset_id: 'single-user', entity_type: 'user', entity_id: 'other', created_at: '2026-10-30' },
    ];
  });

  it('preserves individual owner decisions when batch association order differs', async () => {
    const auth = context();
    expect(await isAssetReadAllowed(db, 'tenant-a', auth, assets[0])).toBe(true);
    state.lookups = [];

    expect(await filterReadableAssets(db, 'tenant-a', auth, assets, {
      resolveMultiUserOwnersIndividually: true,
    })).toEqual([assets[0]]);
    expect(state.lookups).toEqual([['multi-user', 'single-user'], ['multi-user']]);
  });

  it('uses the same owner in a single batch without individual owner resolution', async () => {
    expect(await filterReadableAssets(db, 'tenant-a', context(), assets)).toEqual([assets[0]]);
    expect(state.lookups).toEqual([['multi-user', 'single-user']]);
  });

  it('denies ownership to a newer user association in individual and batch decisions', async () => {
    state.associations[0].created_at = '2026-11-01';
    expect(await isAssetReadAllowed(db, 'tenant-a', context(), assets[0])).toBe(false);
    expect(await filterReadableAssets(db, 'tenant-a', context(), assets)).toEqual([]);
  });

  it.each(['update', 'delete'] as const)('allows %s only for the oldest associated owner', async (action) => {
    state.associations.reverse();
    expect(await isAssetActionAllowed(db, 'tenant-a', context(), assets[0], action)).toBe(true);

    const newerAssignee = context();
    newerAssignee.subject.userId = 'other';
    expect(await isAssetActionAllowed(db, 'tenant-a', newerAssignee, assets[0], action)).toBe(false);
  });

  it('breaks timestamp ties by user id and places null timestamps last', async () => {
    state.associations = [
      { asset_id: 'multi-user', entity_type: 'user', entity_id: 'zzz', created_at: '2026-10-30' },
      { asset_id: 'multi-user', entity_type: 'user', entity_id: 'aaa', created_at: null },
      { asset_id: 'multi-user', entity_type: 'user', entity_id: 'owner', created_at: '2026-10-30' },
    ];
    expect(await isAssetReadAllowed(db, 'tenant-a', context(), assets[0])).toBe(true);
    expect(await filterReadableAssets(db, 'tenant-a', context(), assets)).toEqual([assets[0]]);
  });
});
