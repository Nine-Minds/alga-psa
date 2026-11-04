import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state = {
    allowedAssetIds: new Set<string>(['asset-in-scope']),
    deniedClientIds: new Set<string>(),
    rows: {} as Record<string, Row[]>,
    mappingWrites: 0,
    assignments: [] as string[],
  };

  const reset = () => {
    state.allowedAssetIds = new Set(['asset-in-scope']);
    state.deniedClientIds.clear();
    state.rows = {
      assets: [
        { asset_id: 'asset-in-scope', client_id: 'client-in-scope' },
        { asset_id: 'asset-out-of-scope', client_id: 'client-out-of-scope' },
      ],
      contacts: [
        { contact_name_id: 'contact-in-scope', client_id: 'client-in-scope', contact_kind: 'person' },
        { contact_name_id: 'contact-out-of-scope', client_id: 'client-out-of-scope', contact_kind: 'person' },
      ],
      rmm_integrations: [{ integration_id: 'integration-1', provider: 'ninjaone' }],
      rmm_organization_mappings: [
        { integration_id: 'integration-1', client_id: 'client-in-scope' },
      ],
    };
    state.mappingWrites = 0;
    state.assignments = [];
  };

  const query = (tableName: string) => {
    let rows = [...(state.rows[tableName] ?? [])];
    const qb: any = {
      where(criteria: Row) {
        rows = rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
        return qb;
      },
      whereIn(column: string, values: string[]) {
        rows = rows.filter((row) => values.includes(row[column]));
        return qb;
      },
      whereNot(criteria: Row) {
        rows = rows.filter((row) => !Object.entries(criteria).every(([key, value]) => row[key] === value));
        return qb;
      },
      select() { return qb; },
      first() { return Promise.resolve(rows[0]); },
      then(resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return qb;
  };

  const knex: any = (tableName: string) => query(tableName);
  const context = {
    subject: { tenant: 'tenant-1', userId: 'user-1', userType: 'internal' },
    requestCache: {},
    authorizationKernel: {
      authorizeResource: vi.fn(async ({ resource, record }: any) => ({
        allowed: !state.deniedClientIds.has(record?.clientId),
        scope: { allowAll: true, denied: false, constraints: [] },
        redactedFields: [], reasons: [],
      })),
    },
  };
  const shared = {
    suggestContactForAsset: vi.fn(async (_conn: unknown, _tenant: string, assetId: string, check: (request: any) => Promise<boolean>) => {
      const allowed = await check({
        assetIds: [assetId], contactId: null, integrationId: 'integration-1', provider: 'ninjaone', action: 'read',
      });
      if (!allowed) throw new Error('Permission denied: Cannot read this asset RMM identity');
      return {
        rawUser: 'CORP\\jdoe', key: 'jdoe', contactId: null, contactName: null,
        method: null, integrationId: 'integration-1', provider: 'ninjaone',
      };
    }),
    mapSignedInUserToContact: vi.fn(async (_trx: unknown, _tenant: string, args: any) => {
      const initialAllowed = await args.authorize({
        assetIds: args.assignAssetId ? [args.assignAssetId] : [],
        contactId: args.contactId,
        integrationId: args.integrationId,
        provider: args.provider,
        action: 'update',
      });
      if (!initialAllowed) throw new Error('Permission denied: Cannot map this RMM user');
      state.mappingWrites += 1;
      for (const candidate of ['asset-in-scope', 'asset-out-of-scope']) {
        const allowed = await args.authorize({
          assetIds: [candidate], contactId: args.contactId,
          integrationId: args.integrationId, provider: args.provider, action: 'update',
        });
        if (allowed) state.assignments.push(candidate);
      }
      return { key: 'jdoe', assignedAssetIds: [...state.assignments] };
    }),
  };

  return { state, reset, knex, context, shared };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(
    { user_id: 'user-1', user_type: 'internal', roles: [] },
    { tenant: 'tenant-1' },
    ...args,
  ),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knex })),
  tenantDb: (conn: any) => ({ table: (name: string) => conn(name) }),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) => callback(h.knex)),
}));

vi.mock('@alga-psa/shared/rmm/signedInUserMappings', () => h.shared);
vi.mock('../../lib/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn(async () => h.context),
  isAssetReadAllowed: vi.fn(async (_conn: unknown, _tenant: unknown, _context: unknown, asset: { asset_id: string }) =>
    h.state.allowedAssetIds.has(asset.asset_id)
  ),
}));

const { mapRmmUserToContact, suggestAssigneeFromRmmUser } = await import('../rmmUserAssignmentActions');

beforeEach(() => {
  h.reset();
  h.shared.suggestContactForAsset.mockClear();
  h.shared.mapSignedInUserToContact.mockClear();
  h.context.authorizationKernel.authorizeResource.mockClear();
});

describe('RMM user mapping record authorization', () => {
  it('does not return the signed-in identity for an asset outside caller scope', async () => {
    const result = await suggestAssigneeFromRmmUser('asset-out-of-scope');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(result).not.toHaveProperty('rawUser');
    expect(h.shared.suggestContactForAsset).toHaveBeenCalledWith(
      h.knex, 'tenant-1', 'asset-out-of-scope', expect.any(Function),
    );
  });

  it('rejects caller-supplied integration/provider and contact scope before mapping writes', async () => {
    const integrationMismatch = await mapRmmUserToContact({
      integrationId: 'integration-out-of-scope', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-in-scope',
    });
    expect(integrationMismatch).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.mappingWrites).toBe(0);

    const providerMismatch = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'tacticalrmm', rawUser: 'CORP\\jdoe',
      contactId: 'contact-in-scope',
    });
    expect(providerMismatch).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.mappingWrites).toBe(0);

    h.state.deniedClientIds.add('client-out-of-scope');
    const contactMismatch = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-out-of-scope',
    });
    expect(contactMismatch).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.mappingWrites).toBe(0);
  });

  it('rejects an explicit out-of-scope assignment before writing the mapping', async () => {
    const result = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-in-scope', assignAssetId: 'asset-out-of-scope',
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.mappingWrites).toBe(0);
    expect(h.state.assignments).toEqual([]);
  });

  it('keeps the mapping and assignments for authorized candidates while filtering excluded candidates', async () => {
    const result = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-in-scope', assignAssetId: 'asset-in-scope',
    });

    expect(result).toMatchObject({ key: 'jdoe', assignedAssetIds: ['asset-in-scope'] });
    expect(h.state.mappingWrites).toBe(1);
    expect(h.state.assignments).toEqual(['asset-in-scope']);
  });
});
