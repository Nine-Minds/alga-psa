import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: {
    user_id: 'portal-user',
    user_type: 'client',
    clientId: 'client-1',
    contact_id: 'contact-1',
    roles: [],
    tenant: 'tenant-1',
  },
  trx: { transactionId: 'portal-asset-read' },
  assets: [] as Array<Record<string, any>>,
  memberIds: [] as string[],
  visibility: { clientId: 'client-1', contactId: 'contact-1', visibleAssetIds: new Set<string>() as Set<string> },
  groupSummary: { group_id: 'group-1', name: 'Restricted workspace', member_count: 2, user_count: 1 },
  authzCalls: [] as Array<{ trx: unknown; tenant: string; user: any; assetId: string }>,
  checks: [] as Array<{ trx: unknown; assetId: string; visible: boolean }>,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(h.user, { tenant: h.user.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_knex: unknown, work: (trx: unknown) => Promise<unknown>) => work(h.trx),
  tenantDb: () => ({
    table: (table: string) => {
      if (table !== 'assets') throw new Error(`Unexpected table: ${table}`);
      let whereAssetId: string | undefined;
      const query: any = {
        where(key: string, value: string) {
          if (key === 'assets.asset_id') whereAssetId = value;
          return query;
        },
        select() { return query; },
        orderBy() { return query; },
        limit() { return query; },
        offset() { return query; },
        first() {
          return Promise.resolve(h.visibility.visibleAssetIds.has(whereAssetId ?? '')
            ? h.assets.find((asset) => asset.asset_id === whereAssetId)
            : undefined);
        },
      };
      return query;
    },
    tenantJoin(query: unknown) { return query; },
  }),
}));

vi.mock('@alga-psa/authorization/portal/visibility', () => ({
  applyAssetVisibilityFilter: (query: unknown) => query,
}));

vi.mock('@alga-psa/assets/lib/assetStatusRegistry', () => ({
  assetStatusKindForSlug: vi.fn(),
  assetStatusLabelForSlug: vi.fn(),
  listAssetStatusRows: vi.fn(),
}));

vi.mock('./visibilityResolver', () => ({
  getClientContactVisibilityContext: async () => h.visibility,
}));

vi.mock('@alga-psa/assets/lib/assetGroups', () => ({
  getAuthorizedAssetGroupSummary: async (trx: unknown, tenant: string, user: any, assetId: string, check: any) => {
    h.authzCalls.push({ trx, tenant, user, assetId });
    const memberResults = await Promise.all(h.memberIds.map(async (memberId) => {
      const visible = await check(trx, memberId);
      h.checks.push({ trx, assetId: memberId, visible });
      return visible;
    }));
    return memberResults.every(Boolean) ? h.groupSummary : null;
  },
  getAuthorizedAssetGroupSummariesForAssets: vi.fn(),
}));

describe('client asset group summary authorization', () => {
  beforeEach(() => {
    h.assets = [{
      asset_id: 'visible-asset',
      tenant: 'tenant-1',
      client_id: 'client-1',
      name: 'Visible workstation',
      asset_type: 'workstation',
      created_at: '2026-11-03T00:00:00.000Z',
      updated_at: '2026-11-03T00:00:00.000Z',
    }];
    h.memberIds = ['visible-asset', 'hidden-asset'];
    h.visibility = {
      clientId: 'client-1',
      contactId: 'contact-1',
      visibleAssetIds: new Set(['visible-asset']),
    };
    h.authzCalls = [];
    h.checks = [];
    vi.resetModules();
  });

  it('keeps the visible portal asset but suppresses metadata when a group member is hidden', async () => {
    const { getClientAssetById } = await import('./client-assets');

    const asset = await getClientAssetById('visible-asset');

    expect(asset).toMatchObject({ asset_id: 'visible-asset', name: 'Visible workstation', group: null });
    expect(JSON.stringify(asset)).not.toContain('Restricted workspace');
    expect(h.authzCalls).toEqual([{
      trx: h.trx,
      tenant: 'tenant-1',
      user: expect.objectContaining({ user_id: 'portal-user', user_type: 'client', clientId: 'client-1' }),
      assetId: 'visible-asset',
    }]);
    expect(h.checks).toEqual([
      { trx: h.trx, assetId: 'visible-asset', visible: true },
      { trx: h.trx, assetId: 'hidden-asset', visible: false },
    ]);
  });
});
