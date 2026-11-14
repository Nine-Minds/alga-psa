import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const GROUP = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rules: [] as Row[],
  associationIds: [] as string[][],
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_trx: unknown, tenant: string) => ({
    table(name: string) {
      let rows = (h.tables[name] ?? []).filter((row) => row.tenant === tenant).map((row) => ({ ...row }));
      const query: any = {
        where(criteria: Row) {
          rows = rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
          return query;
        },
        whereIn(key: string, values: string[]) {
          if (name === 'asset_associations') {
            h.associationIds.push([...values]);
            if (values.some((value) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) {
              throw new Error('invalid input syntax for type uuid');
            }
          }
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        orderBy() { return query; },
        select() { return query; },
        first() { return Promise.resolve(rows[0]); },
        pluck(key: string) { return Promise.resolve(rows.map((row) => row[key])); },
        count(expression: string) {
          const key = expression.split(' as ')[1] ?? 'count';
          const result: any = Promise.resolve([{ [key]: String(rows.length) }]);
          result.first = () => Promise.resolve({ [key]: String(rows.length) });
          result.groupBy = (groupKey: string) => {
            const counts = new Map<string, number>();
            for (const row of rows) counts.set(row[groupKey], (counts.get(row[groupKey]) ?? 0) + 1);
            return Promise.resolve(Array.from(counts, ([group, count]) => ({ [groupKey]: group, [key]: String(count) })));
          };
          return result;
        },
        then(resolve: (value: Row[]) => void, reject?: (reason: unknown) => void) {
          return Promise.resolve(rows).then(resolve, reject);
        },
        catch(reject: (reason: unknown) => void) { return Promise.resolve(rows).catch(reject); },
      };
      return query;
    },
  }),
}));

// Keep bundle assignment loading at the database boundary while exercising the
// production asset resolver, bundle provider, relationship templates, and kernel.
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async (_trx: unknown, input: any) =>
    h.rules.filter((rule) => !rule.apiKeyId || rule.apiKeyId === input.subject.apiKeyId)),
}));

import { isAssetGroupOperationAllowed } from './assetGroupAuthorization';
import { getAuthorizedAssetGroupSummariesForAssets, getAuthorizedAssetGroupSummary } from './assetGroups';
import { assetMatchesVisibility } from '@alga-psa/authorization/portal/visibility';

describe('asset group authorization with the production asset resolver and kernel', () => {
  beforeEach(() => {
    h.rules = [];
    h.associationIds = [];
    h.tables = {
      clients: [{ tenant: TENANT, client_id: CLIENT }],
      asset_groups: [{ tenant: TENANT, group_id: GROUP, client_id: CLIENT }],
      asset_group_contacts: [],
      asset_group_members: [{ tenant: TENANT, group_id: GROUP, asset_id: ASSET }],
      assets: [{ tenant: TENANT, asset_id: ASSET, client_id: CLIENT }],
      client_locations: [],
      asset_associations: [],
      team_members: [],
      users: [],
    };
  });

  it('allows unrestricted member access without resolving a fabricated client asset id', async () => {
    await expect(isAssetGroupOperationAllowed({} as any, TENANT, { user_id: 'u1', user_type: 'internal', roles: ['r1'] }, { action: 'read', groupId: GROUP })).resolves.toBe(true);
    expect(h.associationIds).toEqual([[ASSET]]);
  });

  it('returns an allowed single summary and suppresses the entire mixed-scope group', async () => {
    h.tables.asset_groups[0].name = 'Private group name';
    h.tables.asset_groups[0].kind = 'bundle';
    h.tables.asset_group_members.push({ tenant: TENANT, group_id: GROUP, asset_id: '44444444-4444-4444-8444-444444444444' });
    h.tables.assets.push({ tenant: TENANT, asset_id: '44444444-4444-4444-8444-444444444444', client_id: CLIENT });
    h.tables.team_members = [{ tenant: TENANT, user_id: 'u1', team_id: 'team-1' }];
    h.tables.asset_associations = [{ tenant: TENANT, asset_id: ASSET, entity_type: 'team', entity_id: 'team-1' }];
    h.rules = [{ id: 'same-team-read', resource: 'asset', action: 'read', templateKey: 'same_team' }];
    const user = { user_id: 'u1', user_type: 'internal', roles: ['r1'] } as any;

    await expect(getAuthorizedAssetGroupSummary({} as any, TENANT, user, ASSET)).resolves.toBeNull();
    await expect(getAuthorizedAssetGroupSummariesForAssets({} as any, TENANT, user, [ASSET])).resolves.toEqual(new Map());
  });

  it('preserves API-key identity so key-targeted same-team narrowing applies to every member', async () => {
    h.tables.asset_groups[0].name = 'Restricted workspace';
    h.tables.asset_groups[0].kind = 'bundle';
    h.tables.asset_group_members.push({ tenant: TENANT, group_id: GROUP, asset_id: '44444444-4444-4444-8444-444444444444' });
    h.tables.assets.push({ tenant: TENANT, asset_id: '44444444-4444-4444-8444-444444444444', client_id: CLIENT });
    h.rules = [{
      id: 'api-key-same-team', apiKeyId: 'restricted-key', resource: 'asset', action: 'read', templateKey: 'same_team',
    }];
    const user = { user_id: 'u1', user_type: 'internal', roles: ['r1'], apiKeyId: 'restricted-key' } as any;

    await expect(getAuthorizedAssetGroupSummary({} as any, TENANT, user, ASSET)).resolves.toBeNull();
    await expect(getAuthorizedAssetGroupSummariesForAssets({} as any, TENANT, user, [ASSET])).resolves.toEqual(new Map());
  });

  it('composes an additional caller visibility policy across all group members', async () => {
    const hiddenMemberId = '44444444-4444-4444-8444-444444444444';
    h.tables.asset_group_members.push({ tenant: TENANT, group_id: GROUP, asset_id: hiddenMemberId });
    h.tables.asset_groups[0].kind = 'bundle';
    h.tables.asset_groups[0].name = 'Portal workspace';
    h.tables.assets[0].contact_name_id = 'contact-a';
    h.tables.assets.push({ tenant: TENANT, asset_id: hiddenMemberId, client_id: CLIENT, contact_name_id: 'contact-b' });
    const visibility = { contactId: 'contact-a', clientId: CLIENT, effectiveAssetScope: 'contact' as const, visibleContactIds: [] as string[] };
    const portalVisibility = async (_trx: unknown, assetId: string) => {
      const asset = h.tables.assets.find((row) => row.asset_id === assetId);
      const membership = h.tables.asset_group_members.find((row) => row.asset_id === assetId);
      const group = h.tables.asset_groups.find((row) => row.group_id === membership?.group_id);
      const sharedWorkspaceContactIds = group?.kind === 'shared_workspace'
        ? h.tables.asset_group_contacts
          .filter((row) => row.group_id === group.group_id && row.role === 'user')
          .map((row) => row.contact_name_id)
        : [];
      return assetMatchesVisibility({
        clientId: asset?.client_id,
        contactId: asset?.contact_name_id,
        sharedWorkspaceContactIds,
      }, visibility);
    };
    const user = { user_id: 'u1', user_type: 'internal', roles: ['r1'] } as any;

    await expect(getAuthorizedAssetGroupSummary({} as any, TENANT, user, ASSET, portalVisibility)).resolves.toBeNull();
    await expect(getAuthorizedAssetGroupSummariesForAssets({} as any, TENANT, user, [ASSET], portalVisibility)).resolves.toEqual(new Map());
    visibility.visibleContactIds = ['contact-a', 'contact-b'];
    await expect(getAuthorizedAssetGroupSummary({} as any, TENANT, user, ASSET, portalVisibility)).resolves.toMatchObject({ group_id: GROUP });
    visibility.visibleContactIds = [];
    h.tables.asset_groups[0].kind = 'shared_workspace';
    h.tables.asset_group_contacts = [{ tenant: TENANT, group_id: GROUP, contact_name_id: 'contact-a', role: 'user' }];
    await expect(getAuthorizedAssetGroupSummariesForAssets({} as any, TENANT, user, [ASSET], portalVisibility)).resolves.toMatchObject(
      new Map([[ASSET, expect.objectContaining({ group_id: GROUP, name: 'Portal workspace' })]]),
    );
  });

  it('retains summaries for fully authorized groups and filters denied groups in a mixed batch', async () => {
    const allowedGroup = '55555555-5555-4555-8555-555555555555';
    const allowedAsset = '66666666-6666-4666-8666-666666666666';
    h.tables.asset_groups.push({ tenant: TENANT, group_id: allowedGroup, client_id: CLIENT, name: 'Allowed group', kind: 'bundle' });
    h.tables.asset_group_members.push({ tenant: TENANT, group_id: allowedGroup, asset_id: allowedAsset });
    h.tables.assets.push({ tenant: TENANT, asset_id: allowedAsset, client_id: CLIENT });
    h.tables.team_members = [{ tenant: TENANT, user_id: 'u1', team_id: 'team-1' }];
    h.tables.asset_associations = [{ tenant: TENANT, asset_id: allowedAsset, entity_type: 'team', entity_id: 'team-1' }];
    h.tables.asset_groups[0].name = 'Denied group';
    h.tables.asset_groups[0].kind = 'bundle';
    h.tables.asset_group_members.push({ tenant: TENANT, group_id: GROUP, asset_id: '77777777-7777-4777-8777-777777777777' });
    h.tables.assets.push({ tenant: TENANT, asset_id: '77777777-7777-4777-8777-777777777777', client_id: CLIENT });
    h.rules = [{ id: 'same-team-read', resource: 'asset', action: 'read', templateKey: 'same_team' }];
    const user = { user_id: 'u1', user_type: 'internal', roles: ['r1'] } as any;

    await expect(getAuthorizedAssetGroupSummary({} as any, TENANT, user, allowedAsset)).resolves.toMatchObject({ group_id: allowedGroup, name: 'Allowed group', member_count: 1 });
    const result = await getAuthorizedAssetGroupSummariesForAssets({} as any, TENANT, user, [ASSET, allowedAsset]);
    expect(result).toEqual(new Map([[allowedAsset, expect.objectContaining({ group_id: allowedGroup, name: 'Allowed group', member_count: 1 })]]));
  });

  it('suppresses a previously allowed summary after access to any member is revoked', async () => {
    const secondAsset = '44444444-4444-4444-8444-444444444444';
    h.tables.asset_groups[0].name = 'Team workspace';
    h.tables.asset_groups[0].kind = 'bundle';
    h.tables.asset_group_members.push({ tenant: TENANT, group_id: GROUP, asset_id: secondAsset });
    h.tables.assets.push({ tenant: TENANT, asset_id: secondAsset, client_id: CLIENT });
    h.tables.team_members = [{ tenant: TENANT, user_id: 'u1', team_id: 'team-1' }];
    h.tables.asset_associations = [
      { tenant: TENANT, asset_id: ASSET, entity_type: 'team', entity_id: 'team-1' },
      { tenant: TENANT, asset_id: secondAsset, entity_type: 'team', entity_id: 'team-1' },
    ];
    h.rules = [{ id: 'same-team-read', resource: 'asset', action: 'read', templateKey: 'same_team' }];
    const user = { user_id: 'u1', user_type: 'internal', roles: ['r1'] } as any;

    await expect(getAuthorizedAssetGroupSummary({} as any, TENANT, user, ASSET))
      .resolves.toMatchObject({ group_id: GROUP, name: 'Team workspace', member_count: 2 });

    h.tables.asset_associations = h.tables.asset_associations.filter((association) => association.asset_id !== secondAsset);

    // The readable asset remains available to its caller, while the group is
    // now denied atomically because one member fell outside the caller's scope.
    await expect(getAuthorizedAssetGroupSummary({} as any, TENANT, user, ASSET)).resolves.toBeNull();
    await expect(getAuthorizedAssetGroupSummariesForAssets({} as any, TENANT, user, [ASSET])).resolves.toEqual(new Map());
  });

  it('denies a selected-client restriction before resolving member relationships', async () => {
    h.rules = [{
      id: 'selected-client-read',
      resource: 'asset',
      action: 'read',
      templateKey: 'selected_clients',
      selectedClientIds: ['44444444-4444-4444-8444-444444444444'],
    }];

    await expect(isAssetGroupOperationAllowed({} as any, TENANT, { user_id: 'u1', user_type: 'internal', roles: ['r1'] }, { action: 'read', groupId: GROUP })).resolves.toBe(false);
    expect(h.associationIds).toEqual([]);
  });

  it('allows a team-scoped mutation when each real member is assigned to the caller team', async () => {
    h.tables.team_members = [{ tenant: TENANT, user_id: 'u1', team_id: 'team-1' }];
    h.tables.asset_associations = [{ tenant: TENANT, asset_id: ASSET, entity_type: 'team', entity_id: 'team-1' }];
    h.rules = [{ id: 'same-team-update', resource: 'asset', action: 'update', templateKey: 'same_team' }];

    await expect(isAssetGroupOperationAllowed({} as any, TENANT, { user_id: 'u1', user_type: 'internal', roles: ['r1'] }, { action: 'update', groupId: GROUP })).resolves.toBe(true);
    expect(h.associationIds).toEqual([[ASSET], [ASSET]]);
  });
});
