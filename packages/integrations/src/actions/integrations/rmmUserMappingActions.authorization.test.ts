import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state = {
    deniedAssets: new Set<string>(),
    deniedContacts: new Set<string>(),
    deniedIntegrations: new Set<string>(),
    deniedCoarsePermissions: new Set<string>(),
    mappings: new Map<string, string>(),
    assignments: new Map<string, string>(),
    rows: {
      rmm_organization_mappings: [{ integration_id: 'integration-1', mapping_id: 'mapping-1', external_organization_id: 'org-1', client_id: 'client-1', contact_assignment_mode: 'suggest' }],
      rmm_integrations: [{ integration_id: 'integration-1', provider: 'ninjaone' }],
      assets: [{ asset_id: 'asset-excluded', client_id: 'client-2' }, { asset_id: 'asset-allowed', client_id: 'client-1' }, { asset_id: 'asset-auto-candidate', client_id: 'client-1' }],
      contacts: [{ contact_name_id: 'contact-1', client_id: 'client-1', contact_kind: 'person' }],
    } as Record<string, Row[]>,
  };

  const query = (tableName: string) => {
    let rows = [...(state.rows[tableName] ?? [])];
    const qb: any = {
      where(criteria: Row) { rows = rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value)); return qb; },
      whereIn(column: string, values: string[]) { rows = rows.filter((row) => values.includes(row[column])); return qb; },
      whereNot(criteria: Row) { rows = rows.filter((row) => !Object.entries(criteria).every(([key, value]) => row[key] === value)); return qb; },
      select() { return qb; },
      first() { return Promise.resolve(rows[0]); },
      then(resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) { return Promise.resolve(rows).then(resolve, reject); },
    };
    return qb;
  };
  const knex: any = (tableName: string) => query(tableName);

  const mapCore = vi.fn(async (_trx: unknown, _tenant: string, args: any) => {
    await args.authorize({ assetIds: args.assignAssetId ? [args.assignAssetId] : [], contactId: args.contactId, integrationId: args.integrationId });
    state.mappings.set(args.rawUser, args.contactId);
    if (args.assignAssetId) state.assignments.set(args.assignAssetId, args.contactId);
    else {
      await args.authorize({ assetIds: ['asset-auto-candidate'], contactId: args.contactId, integrationId: args.integrationId });
      state.assignments.set('asset-auto-candidate', args.contactId);
    }
    return { key: 'jdoe', assignedAssetIds: args.assignAssetId ? [args.assignAssetId] : ['asset-auto-candidate'] };
  });
  return { state, knex, mapCore };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal', roles: [] }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    !h.state.deniedCoarsePermissions.has(`${resource}:${action}`)),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knex })),
  tenantDb: (conn: any) => ({ table: (name: string) => conn(name) }),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) => callback(h.knex)),
}));
vi.mock('@alga-psa/authorization/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn(async () => ({
    subject: { userId: 'user-1', userType: 'internal' },
    requestCache: {},
    authorizationKernel: {
      authorizeResource: vi.fn(async ({ resource, record }: any) => ({
        allowed: resource.type === 'contact'
          ? !h.state.deniedContacts.has(resource.id)
          : !h.state.deniedIntegrations.has(resource.id),
      })),
    },
  })),
  isAssetReadAllowed: vi.fn(async (_trx: unknown, _tenant: string, _context: unknown, asset: { asset_id: string }) => !h.state.deniedAssets.has(asset.asset_id)),
  isAssetActionAllowed: vi.fn(async (_trx: unknown, _tenant: string, _context: unknown, asset: { asset_id: string }) => !h.state.deniedAssets.has(asset.asset_id)),
}));
vi.mock('@alga-psa/shared/rmm/moveRmmOrganizationAssets', () => ({ countRmmOrganizationAssets: vi.fn() }));
vi.mock('@alga-psa/shared/rmm/signedInUserMappings', () => ({
  RmmUserMappingAuthorizationError: class RmmUserMappingAuthorizationError extends Error { constructor() { super('Permission denied: Cannot access this RMM user mapping'); } },
  mapSignedInUserToContact: h.mapCore,
  listSignedInUsersForOrganization: vi.fn(),
}));

const { mapRmmSignedInUserToContact } = await import('./rmmUserMappingActions');

beforeEach(() => {
  h.state.deniedAssets.clear();
  h.state.deniedContacts.clear();
  h.state.deniedIntegrations.clear();
  h.state.deniedCoarsePermissions.clear();
  h.state.mappings.clear();
  h.state.assignments.clear();
  h.mapCore.mockClear();
});

describe('settings RMM mapping authorization', () => {
  it.each([
    ['asset:read', 'asset-allowed'],
    ['asset:update', 'asset-allowed'],
    ['asset:read', undefined],
    ['asset:update', undefined],
  ] as const)('rejects explicit and automatic assignment paths when coarse %s is denied', async (permission, assignAssetId) => {
    h.state.deniedCoarsePermissions.add(permission);

    const result = await mapRmmSignedInUserToContact({
      mappingId: 'mapping-1', rawUser: 'CORP\\jdoe', contactId: 'contact-1', assignAssetId,
    });

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Permission denied') });
    expect(h.state.mappings.size).toBe(0);
    expect(h.state.assignments.size).toBe(0);
    expect(h.mapCore).not.toHaveBeenCalled();
  });

  it('rejects the settings action explicit excluded target without changing persistent state', async () => {
    h.state.deniedAssets.add('asset-excluded');

    const result = await mapRmmSignedInUserToContact({
      mappingId: 'mapping-1', rawUser: 'CORP\\jdoe', contactId: 'contact-1', assignAssetId: 'asset-excluded',
    });

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Permission denied') });
    expect(h.state.mappings.size).toBe(0);
    expect(h.state.assignments.size).toBe(0);
    expect(h.mapCore).toHaveBeenCalledWith(h.knex, 'tenant-1', expect.objectContaining({
      integrationId: 'integration-1', provider: 'ninjaone', assignAssetId: 'asset-excluded',
      authorize: expect.any(Function),
    }));
  });

  it('keeps the allowed settings mapping and assignment path working', async () => {
    const result = await mapRmmSignedInUserToContact({
      mappingId: 'mapping-1', rawUser: 'CORP\\jdoe', contactId: 'contact-1', assignAssetId: 'asset-allowed',
    });

    expect(result).toEqual({ success: true, assignedCount: 1 });
    expect(h.state.mappings.get('CORP\\jdoe')).toBe('contact-1');
    expect(h.state.assignments.get('asset-allowed')).toBe('contact-1');
  });
});
