import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  permission: true,
  allowed: true,
  rules: [{ resource: 'asset', action: 'read' }] as Array<{ resource: string; action: string }>,
  asset: { asset_id: 'asset-1', client_id: 'client-1' } as { asset_id: string; client_id: string } | undefined,
  calls: [] as unknown[][],
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: vi.fn(async (...args: unknown[]) => { h.calls.push(args); return h.permission; }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ where: () => ({ select: () => ({ first: async () => h.asset }) }) }) }),
}));
vi.mock('@alga-psa/authorization/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn(async () => ({ subject: { tenant: 'tenant-1', userId: 'user-1' }, requestCache: {} })),
  isAssetActionAllowed: vi.fn(async (...args: unknown[]) => { h.calls.push(args); return h.allowed; }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async (...args: unknown[]) => { h.calls.push(args); return h.rules; }),
}));

import { assertAssetAccess } from './assetReadAuthorization';

describe('assertAssetAccess', () => {
  beforeEach(() => {
    h.permission = true;
    h.allowed = true;
    h.rules = [{ resource: 'asset', action: 'read' }];
    h.asset = { asset_id: 'asset-1', client_id: 'client-1' };
    h.calls = [];
  });

  it.each(['read', 'update', 'delete'] as const)('requires the matching coarse and record-level permission for %s', async (action) => {
    h.rules = [{ resource: 'asset', action }];
    const user = { user_id: 'user-1', user_type: 'internal' as const };
    await expect(assertAssetAccess({} as any, 'tenant-1', user, 'asset-1', action)).resolves.toEqual(h.asset);
    expect(h.calls[0]).toEqual([user, 'asset', action, {}]);
    expect(h.calls[2][3]).toEqual({ asset_id: 'asset-1', client_id: 'client-1' });
    expect(h.calls[2][4]).toBe(action);
  });

  it('denies when the requested verb has no policy rule', async () => {
    await expect(assertAssetAccess({} as any, 'tenant-1', { user_id: 'user-1', user_type: 'internal' }, 'asset-1', 'delete'))
      .rejects.toThrow('Asset not found');
    expect(h.calls).toHaveLength(2); // coarse permission and rule resolution only
  });

  it('conceals missing and denied assets with the same not-found shape', async () => {
    h.asset = undefined;
    await expect(assertAssetAccess({} as any, 'tenant-1', { user_id: 'user-1', user_type: 'internal' }, 'missing', 'read'))
      .rejects.toThrow('Asset not found');
    h.asset = { asset_id: 'asset-1', client_id: 'client-1' };
    h.allowed = false;
    await expect(assertAssetAccess({} as any, 'tenant-1', { user_id: 'user-1', user_type: 'internal' }, 'asset-1', 'read'))
      .rejects.toThrow('Asset not found');
  });

  it('denies when the coarse asset permission is missing', async () => {
    h.permission = false;
    await expect(assertAssetAccess({} as any, 'tenant-1', { user_id: 'user-1', user_type: 'internal' }, 'asset-1', 'update'))
      .rejects.toThrow('Asset not found');
  });
});
