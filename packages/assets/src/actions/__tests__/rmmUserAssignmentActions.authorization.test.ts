import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  createAssetReadContext,
  isAssetActionAllowed,
  isAssetReadAllowed,
  resolveAssetAuthorizationRecords,
} from '../../lib/assetReadAuthorization';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state = {
    rows: {} as Record<string, Row[]>,
    mappingWrites: 0,
    assignments: [] as string[],
    scopedResources: [] as string[],
    deniedCoarsePermissions: [] as string[],
  };

  const reset = () => {
    state.rows = {
      assets: [
        { asset_id: 'asset-readable-not-updatable', client_id: 'client-in-scope' },
        { asset_id: 'asset-update-authorized', client_id: 'client-in-scope' },
        { asset_id: 'asset-update-authorized-candidate', client_id: 'client-in-scope' },
        { asset_id: 'asset-out-of-scope', client_id: 'client-out-of-scope' },
        { asset_id: 'asset-updatable-not-readable', client_id: 'client-out-of-scope' },
      ],
      asset_associations: [
        { asset_id: 'asset-update-authorized', entity_type: 'team', entity_id: 'team-ops' },
        { asset_id: 'asset-update-authorized-candidate', entity_type: 'team', entity_id: 'team-ops' },
        { asset_id: 'asset-updatable-not-readable', entity_type: 'team', entity_id: 'team-ops' },
      ],
      user_roles: [],
      team_members: [{ user_id: 'user-1', team_id: 'team-ops' }],
      users: [],
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
    state.scopedResources = [];
    state.deniedCoarsePermissions = [];
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
      // These fixtures exercise association membership, independent of row order.
      orderBy() { return qb; },
      select() { return qb; },
      first() { return Promise.resolve(rows[0]); },
      then(resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve(rows).then(resolve, reject);
      },
      catch(reject: (error: unknown) => unknown) {
        return Promise.resolve(rows).catch(reject);
      },
    };
    return qb;
  };

  const knex: any = (tableName: string) => query(tableName);
  class RmmUserMappingAuthorizationError extends Error {
    constructor() { super('Permission denied: Cannot access this RMM user mapping'); }
  }
  const shared = {
    RmmUserMappingAuthorizationError,
    suggestContactForAsset: vi.fn(async (_conn: unknown, _tenant: string, assetId: string, check?: (request: any) => Promise<void>) => {
      await check?.({
        assetIds: [assetId], contactId: null, integrationId: 'integration-1',
      });
      return {
        rawUser: 'CORP\\jdoe', key: 'jdoe', contactId: null, contactName: null,
        method: null, integrationId: 'integration-1', provider: 'ninjaone',
      };
    }),
    mapSignedInUserToContact: vi.fn(async (_trx: unknown, _tenant: string, args: any) => {
      await args.authorize?.({
        assetIds: args.assignAssetId ? [args.assignAssetId] : [],
        contactId: args.contactId,
        integrationId: args.integrationId,
      });
      state.mappingWrites += 1;
      if (args.assignAssetId) state.assignments.push(args.assignAssetId);
      for (const candidate of [
        'asset-update-authorized-candidate',
        'asset-readable-not-updatable',
        'asset-out-of-scope',
        'asset-updatable-not-readable',
      ]) {
        try {
          await args.authorize?.({
            assetIds: [candidate], contactId: args.contactId,
            integrationId: args.integrationId,
          });
        } catch (error) {
          if (error instanceof RmmUserMappingAuthorizationError) continue;
          throw error;
        }
        state.assignments.push(candidate);
      }
      return { key: 'jdoe', assignedAssetIds: [...state.assignments] };
    }),
  };

  return { state, reset, knex, shared };
});

const selectedClientRule = (resource: string, action: string) => ({
  id: `${resource}-${action}-selected-clients`,
  resource,
  action,
  templateKey: 'selected_clients' as const,
  selectedClientIds: ['client-in-scope'],
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(
    { user_id: 'user-1', user_type: 'internal', roles: [] },
    { tenant: 'tenant-1' },
    ...args,
  ),
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    !h.state.deniedCoarsePermissions.includes(`${resource}:${action}`)),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knex })),
  tenantDb: (conn: any) => ({ table: (name: string) => conn(name) }),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) => callback(h.knex)),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async (_conn: unknown, input: { resource: { type: string } }) => {
    if (input.resource.type === 'asset') {
      return [
        selectedClientRule('asset', 'read'),
        { id: 'asset-update-same-team', resource: 'asset', action: 'update', templateKey: 'same_team' },
      ];
    }
    return h.state.scopedResources.includes(input.resource.type)
      ? [selectedClientRule(input.resource.type, 'read'), selectedClientRule(input.resource.type, 'update')]
      : [];
  }),
}));

vi.mock('@alga-psa/shared/rmm/signedInUserMappings', () => h.shared);

const { mapRmmUserToContact, suggestAssigneeFromRmmUser } = await import('../rmmUserAssignmentActions');

async function assetUpdateRuleAllows(
  context: Awaited<ReturnType<typeof createAssetReadContext>>,
  asset: { asset_id: string; client_id: string },
) {
  // Evaluate the update rule alone: the mutation helper also requires read visibility.
  const records = await resolveAssetAuthorizationRecords(h.knex, 'tenant-1', [asset]);
  const decision = await context.authorizationKernel.authorizeResource({
    subject: context.subject,
    resource: { type: 'asset', action: 'update', id: asset.asset_id },
    record: records.get(asset.asset_id),
    requestCache: context.requestCache,
    knex: h.knex,
  });
  return decision.allowed;
}

beforeEach(() => {
  h.reset();
  h.shared.suggestContactForAsset.mockClear();
  h.shared.mapSignedInUserToContact.mockClear();
});

describe('RMM user mapping record authorization', () => {
  it.each(['asset:read', 'asset:update'])('rejects mapping when coarse %s is denied before any write', async (permission) => {
    h.state.deniedCoarsePermissions = [permission];

    const result = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-in-scope', assignAssetId: 'asset-update-authorized',
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.mappingWrites).toBe(0);
    expect(h.state.assignments).toEqual([]);
    expect(h.shared.mapSignedInUserToContact).not.toHaveBeenCalled();
  });

  it('does not return the signed-in identity for an asset outside caller scope', async () => {
    const result = await suggestAssigneeFromRmmUser('asset-out-of-scope');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(result).not.toHaveProperty('rawUser');
    expect(h.shared.suggestContactForAsset).toHaveBeenCalledWith(
      h.knex, 'tenant-1', 'asset-out-of-scope', expect.any(Function),
    );
  });

  it('returns the signed-in identity for a readable asset without requiring update scope', async () => {
    const result = await suggestAssigneeFromRmmUser('asset-readable-not-updatable');

    expect(result).toEqual({
      rawUser: 'CORP\\jdoe', key: 'jdoe', contactId: null, contactName: null,
      method: null, integrationId: 'integration-1', provider: 'ninjaone',
    });
    expect(h.state.mappingWrites).toBe(0);
    expect(h.state.assignments).toEqual([]);
  });

  it('rejects an unavailable integration before mapping writes', async () => {
    const integrationMismatch = await mapRmmUserToContact({
      integrationId: 'integration-out-of-scope', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-in-scope',
    });
    expect(integrationMismatch).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.mappingWrites).toBe(0);
  });

  it('rejects a contact outside contact record scope before writing', async () => {
    h.state.scopedResources = ['contact'];
    const result = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-out-of-scope',
    });
    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.mappingWrites).toBe(0);
    expect(h.state.assignments).toEqual([]);
  });

  it('rejects integration access in an excluded client scope before writing', async () => {
    h.state.scopedResources = ['rmm_integration'];
    h.state.rows.rmm_organization_mappings = [
      { integration_id: 'integration-1', client_id: 'client-out-of-scope' },
    ];
    const result = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: null,
    });
    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.mappingWrites).toBe(0);
    expect(h.state.assignments).toEqual([]);
  });

  it('writes the mapping and assignments when every asset is in scope', async () => {
    for (const asset of h.state.rows.assets) asset.client_id = 'client-in-scope';
    h.state.rows.asset_associations = h.state.rows.assets.map((asset) => ({
      asset_id: asset.asset_id, entity_type: 'team', entity_id: 'team-ops',
    }));
    const result = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-in-scope', assignAssetId: 'asset-update-authorized',
    });
    expect(result).toMatchObject({ key: 'jdoe', assignedAssetIds: [
      'asset-update-authorized', 'asset-update-authorized-candidate',
      'asset-readable-not-updatable', 'asset-out-of-scope', 'asset-updatable-not-readable',
    ] });
    expect(h.state.mappingWrites).toBe(1);
  });

  it('rejects a readable but non-updatable explicit target before writing the mapping', async () => {
    const authUser = {
      user_id: 'user-1', user_type: 'internal', roles: [],
    } as unknown as IUserWithRoles;
    const context = await createAssetReadContext(h.knex, 'tenant-1', authUser);
    const readableAsset = { asset_id: 'asset-readable-not-updatable', client_id: 'client-in-scope' };

    expect(await isAssetReadAllowed(h.knex, 'tenant-1', context, readableAsset)).toBe(true);
    expect(await isAssetActionAllowed(h.knex, 'tenant-1', context, readableAsset, 'update')).toBe(false);

    const result = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-in-scope', assignAssetId: readableAsset.asset_id,
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.mappingWrites).toBe(0);
    expect(h.state.assignments).toEqual([]);
  });

  it('rejects an updatable but unreadable explicit target before writing the mapping', async () => {
    const authUser = { user_id: 'user-1', user_type: 'internal', roles: [] } as unknown as IUserWithRoles;
    const context = await createAssetReadContext(h.knex, 'tenant-1', authUser);
    const unreadableAsset = { asset_id: 'asset-updatable-not-readable', client_id: 'client-out-of-scope' };

    expect(await isAssetReadAllowed(h.knex, 'tenant-1', context, unreadableAsset)).toBe(false);
    expect(await assetUpdateRuleAllows(context, unreadableAsset)).toBe(true);

    const result = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-out-of-scope', assignAssetId: unreadableAsset.asset_id,
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(h.state.mappingWrites).toBe(0);
    expect(h.state.assignments).toEqual([]);
  });

  it('filters candidates failing either asset scope and assigns assets allowed by both scopes', async () => {
    const result = await mapRmmUserToContact({
      integrationId: 'integration-1', provider: 'ninjaone', rawUser: 'CORP\\jdoe',
      contactId: 'contact-in-scope', assignAssetId: 'asset-update-authorized',
    });

    expect(result).toMatchObject({
      key: 'jdoe', assignedAssetIds: ['asset-update-authorized', 'asset-update-authorized-candidate'],
    });
    expect(h.state.mappingWrites).toBe(1);
    expect(h.state.assignments).toEqual(['asset-update-authorized', 'asset-update-authorized-candidate']);

    const authUser = { user_id: 'user-1', user_type: 'internal', roles: [] } as unknown as IUserWithRoles;
    const context = await createAssetReadContext(h.knex, 'tenant-1', authUser);
    const readableAsset = { asset_id: 'asset-readable-not-updatable', client_id: 'client-in-scope' };
    expect(await isAssetReadAllowed(h.knex, 'tenant-1', context, readableAsset)).toBe(true);
    expect(await isAssetActionAllowed(h.knex, 'tenant-1', context, readableAsset, 'update')).toBe(false);

    const unreadableAsset = { asset_id: 'asset-updatable-not-readable', client_id: 'client-out-of-scope' };
    expect(await isAssetReadAllowed(h.knex, 'tenant-1', context, unreadableAsset)).toBe(false);
    expect(await assetUpdateRuleAllows(context, unreadableAsset)).toBe(true);
  });
});
