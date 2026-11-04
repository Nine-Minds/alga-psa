import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  trx: { transactionId: 'asset-service-read', raw: vi.fn(() => ({})) },
  tables: {} as Record<string, Row[]>,
  inScopeAssets: new Set<string>(),
  summary: { group_id: 'g1', name: 'Restricted workspace', member_count: 2, user_count: 0 },
}));

vi.mock('@alga-psa/db', () => ({
  BaseService: class {
    tableName: string;
    primaryKey: string;
    constructor(options: { tableName: string; primaryKey: string }) {
      this.tableName = options.tableName;
      this.primaryKey = options.primaryKey;
    }
    async getDbForContext(context: { db?: unknown }) { return context.db ?? {}; }
  },
  withTransaction: async (_knex: unknown, work: (trx: unknown) => Promise<unknown>) => work(h.trx),
  tenantDb: (conn: any, tenant: string) => ({
    table(name: string) {
      const table = name.split(' as ')[0];
      let rows = (h.tables[table] ?? []).filter((row) => row.tenant === tenant);
      const strip = (key: string) => key.includes('.') ? key.split('.').pop()! : key;
      const query: any = {
        where(criteria: Row) {
          rows = rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[strip(key)] === value));
          return query;
        },
        select() { return query; },
        first() { return Promise.resolve(rows[0] ? { ...rows[0] } : undefined); },
        then(resolve: (value: Row[]) => void, reject?: (reason: unknown) => void) { return Promise.resolve(rows).then(resolve, reject); },
      };
      return query;
    },
    tenantJoin(query: unknown) { return query; },
  }),
}));

vi.mock('@alga-psa/assets/lib/assetGroups', () => ({
  getAssetGroupSummary: vi.fn(async () => h.summary),
  getAuthorizedAssetGroupSummary: vi.fn(async (trx: unknown, tenant: string, user: any, assetId: string) => {
    const member = (h.tables.asset_group_members ?? []).find((row) => row.tenant === tenant && row.asset_id === assetId);
    if (!member) return null;
    const members = h.tables.asset_group_members.filter((row) => row.tenant === tenant && row.group_id === member.group_id);
    return members.every((row) => h.inScopeAssets.has(row.asset_id)) ? h.summary : null;
  }),
  removeAssetFromAnyGroup: vi.fn(),
}));

import { AssetService } from '../../../lib/api/services/AssetService';
import { getAuthorizedAssetGroupSummary } from '@alga-psa/assets/lib/assetGroups';

const TENANT = 'tenant-1';
const ASSET = 'asset-visible';
const HIDDEN_MEMBER = 'asset-hidden';
const USER = { user_id: 'caller-1', user_type: 'internal', roles: [{ role_id: 'role-1' }] };

describe('AssetService group summaries', () => {
  beforeEach(() => {
    h.tables = {
      assets: [{ tenant: TENANT, asset_id: ASSET, client_id: 'client-1', name: 'Visible asset', asset_type: 'unknown' }],
      asset_group_members: [
        { tenant: TENANT, group_id: 'g1', asset_id: ASSET },
        { tenant: TENANT, group_id: 'g1', asset_id: HIDDEN_MEMBER },
      ],
    };
    h.inScopeAssets = new Set([ASSET]);
    vi.clearAllMocks();
  });

  it('returns the asset while suppressing a mixed-scope group summary', async () => {
    const service = new AssetService();
    const asset = await service.getById(ASSET, { tenant: TENANT, userId: USER.user_id, user: USER } as any);

    expect(asset).toMatchObject({ asset_id: ASSET, name: 'Visible asset', group: null });
    expect(JSON.stringify(asset)).not.toContain('Restricted workspace');
    expect(getAuthorizedAssetGroupSummary).toHaveBeenCalledWith(h.trx, TENANT, expect.objectContaining({ user_id: USER.user_id, user_type: USER.user_type }), ASSET);
  });

  it('carries the verified API-key identity into group authorization', async () => {
    h.inScopeAssets.add(HIDDEN_MEMBER);
    const service = new AssetService();
    const apiKeyId = 'restricted-key-1';
    await service.getById(ASSET, { tenant: TENANT, userId: USER.user_id, user: USER, apiKeyId } as any);

    expect(getAuthorizedAssetGroupSummary).toHaveBeenCalledWith(
      h.trx,
      TENANT,
      expect.objectContaining({ user_id: USER.user_id, apiKeyId }),
      ASSET,
    );
  });

  it('preserves the summary when every group member is authorized', async () => {
    h.inScopeAssets.add(HIDDEN_MEMBER);
    const service = new AssetService();
    const asset = await service.getById(ASSET, { tenant: TENANT, userId: USER.user_id, user: USER } as any);

    expect(asset?.group).toEqual(h.summary);
  });
});
