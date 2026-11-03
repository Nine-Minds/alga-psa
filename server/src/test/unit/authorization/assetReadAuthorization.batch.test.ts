import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const state = vi.hoisted(() => ({
  associations: [] as Array<{ asset_id: string; entity_type: string; entity_id: string }>,
  lookups: [] as string[][],
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => ({
      whereIn: (_column: string, ids: string[]) => ({
        select: async () => {
          state.lookups.push(ids);
          const rows = state.associations.filter((row) => ids.includes(row.asset_id));
          return ids.length > 1 ? rows.reverse() : rows;
        },
      }),
    }),
  }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

import {
  filterReadableAssets,
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
        resolveRules: async () => [{ id: 'own', resource: 'asset', action: 'read', templateKey: 'own' }],
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
      { asset_id: 'multi-user', entity_type: 'user', entity_id: 'owner' },
      { asset_id: 'multi-user', entity_type: 'user', entity_id: 'other' },
      { asset_id: 'single-user', entity_type: 'user', entity_id: 'other' },
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

  it('keeps the existing batched behavior when individual owner resolution is not requested', async () => {
    expect(await filterReadableAssets(db, 'tenant-a', context(), assets)).toEqual([]);
    expect(state.lookups).toEqual([['multi-user', 'single-user']]);
  });
});
