import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const holder = vi.hoisted(() => ({ knex: undefined as unknown as Knex, tenant: '', userId: '' }));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    withAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) =>
      fn({ user_id: holder.userId, tenant: holder.tenant, user_type: 'internal' }, { tenant: holder.tenant }, ...args),
    hasPermission: async () => true,
  };
});

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: async () => ({ knex: holder.knex, tenant: holder.tenant }),
  withTransaction: (db: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(callback),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));

import {
  addAssetsToGroup,
  createAssetGroup,
  deleteAssetGroup,
  removeAssetFromGroup,
  setAssetGroupOwner,
  updateAssetGroup,
} from '../actions/assetGroupActions';
import { createAssetReadContext, isAssetActionAllowed } from './assetReadAuthorization';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../../../inventory/src/test-utils/inventoryTestDatabase';
import { wireLocalTestDbEnv } from '../../../../server/test-utils/dbConfig';
import { tenantDb } from '@alga-psa/db';

const database = (tenant = holder.tenant) => tenantDb(holder.knex, tenant);

describe('asset group mutation authorization', () => {
  let clientId: string;
  let teamId: string;
  let locationId: string;
  let oldOwnerId: string;
  let newOwnerId: string;

  async function createAsset(name: string): Promise<string> {
    const assetId = randomUUID();
    await database().table('assets').insert({
      tenant: holder.tenant,
      asset_id: assetId,
      asset_type: 'unknown',
      client_id: clientId,
      asset_tag: `AG-${assetId.slice(0, 8)}`,
      name,
      serial_number: `S-${assetId.slice(0, 8)}`,
      status: 'active',
      location: 'Original location',
      location_id: null,
      contact_name_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return assetId;
  }

  async function assignAssetToTeam(assetId: string): Promise<void> {
    await database().table('asset_associations').insert({
      tenant: holder.tenant,
      asset_id: assetId,
      entity_type: 'team',
      entity_id: teamId,
      created_by: holder.userId,
    });
  }

  async function createPolicy(): Promise<void> {
    const bundleId = randomUUID();
    const revisionId = randomUUID();
    await database().table('authorization_bundles').insert({
      tenant: holder.tenant,
      bundle_id: bundleId,
      bundle_key: `asset-group-${bundleId.slice(0, 8)}`,
      name: 'Asset Group Restricted Operator',
      is_system: false,
      status: 'active',
    });
    await database().table('authorization_bundle_revisions').insert({
      tenant: holder.tenant,
      revision_id: revisionId,
      bundle_id: bundleId,
      revision_number: 1,
      lifecycle_state: 'published',
    });
    await database().table('authorization_bundles').where({ bundle_id: bundleId }).update({ published_revision_id: revisionId });
    await database().table('authorization_bundle_rules').insert([
      {
        tenant: holder.tenant,
        bundle_id: bundleId,
        revision_id: revisionId,
        resource_type: 'asset',
        action: 'read',
        template_key: 'selected_clients',
        effect: 'narrow',
        config: JSON.stringify({ selectedClientIds: [clientId] }),
        position: 0,
      },
      {
        tenant: holder.tenant,
        bundle_id: bundleId,
        revision_id: revisionId,
        resource_type: 'asset',
        action: 'update',
        template_key: 'same_team',
        effect: 'narrow',
        config: '{}',
        position: 1,
      },
    ]);
    await database().table('authorization_bundle_assignments').insert({
      tenant: holder.tenant,
      bundle_id: bundleId,
      target_type: 'user',
      target_id: holder.userId,
      status: 'active',
    });
  }

  beforeAll(async () => {
    wireLocalTestDbEnv();
    holder.knex = knexLib({ client: 'pg', connection: getInventoryTestDatabaseConnection(), pool: { min: 1, max: 4 } });
    holder.tenant = await createInventoryTestTenant(holder.knex);
    holder.userId = randomUUID();
    await database().table('users').insert({
      tenant: holder.tenant,
      user_id: holder.userId,
      username: `asset-group-${holder.userId}`,
      email: `${holder.userId}@example.invalid`,
      hashed_password: 'not-a-login-credential',
      user_type: 'internal',
      first_name: 'Restricted',
      last_name: 'Operator',
    });
    clientId = (await database().table('clients').first('client_id')).client_id;
    teamId = randomUUID();
    await database().table('teams').insert({ tenant: holder.tenant, team_id: teamId, team_name: 'Asset team', manager_id: holder.userId });
    await database().table('team_members').insert({ tenant: holder.tenant, team_id: teamId, user_id: holder.userId });
    locationId = randomUUID();
    await database().table('client_locations').insert({
      tenant: holder.tenant,
      location_id: locationId,
      client_id: clientId,
      location_name: 'Authorized location',
      address_line1: '1 Main St',
      city: 'Boston',
      country_code: 'US',
      country_name: 'United States',
      is_active: true,
    });
    oldOwnerId = randomUUID();
    newOwnerId = randomUUID();
    await database().table('contacts').insert([oldOwnerId, newOwnerId].map((contactId) => ({
      tenant: holder.tenant,
      contact_name_id: contactId,
      client_id: clientId,
      full_name: `Contact ${contactId.slice(0, 6)}`,
      contact_kind: 'person',
      email: `${contactId}@example.invalid`,
    })));
    await createPolicy();
  }, 180_000);

  afterAll(async () => { await holder.knex?.destroy(); }, 180_000);

  it('authorizes same-team membership and propagation as one transaction', async () => {
    const inTeam = await createAsset('In-team asset');
    const outOfTeam = await createAsset('Readable out-of-team asset');
    await assignAssetToTeam(inTeam);

    const context = await createAssetReadContext(holder.knex, holder.tenant, { user_id: holder.userId, user_type: 'internal' });
    const inTeamRecord = { asset_id: inTeam, client_id: clientId };
    const outOfTeamRecord = { asset_id: outOfTeam, client_id: clientId };
    expect(await isAssetActionAllowed(holder.knex, holder.tenant, context, outOfTeamRecord, 'read')).toBe(true);
    expect(await isAssetActionAllowed(holder.knex, holder.tenant, context, outOfTeamRecord, 'update')).toBe(false);
    expect(await isAssetActionAllowed(holder.knex, holder.tenant, context, inTeamRecord, 'update')).toBe(true);

    const assetState = (ids: string[]) => database().table('assets').whereIn('asset_id', ids)
      .select('asset_id', 'contact_name_id', 'location_id', 'location').orderBy('asset_id');
    const assignmentState = (ids: string[]) => database().table('asset_assignments').whereIn('asset_id', ids)
      .select('asset_id', 'contact_name_id', 'unassigned_at').orderBy('asset_id', 'contact_name_id');

    const groupsBefore = await database().table('asset_groups').count('* as count').first();
    const createAssetsBefore = await assetState([inTeam, outOfTeam]);
    const createAssignmentsBefore = await assignmentState([inTeam, outOfTeam]);
    const deniedCreate = await createAssetGroup({ clientId, name: 'Denied mixed create', kind: 'bundle', locationId, assetIds: [inTeam, outOfTeam] });
    expect(deniedCreate).toHaveProperty('permissionError');
    expect(await database().table('asset_groups').count('* as count').first()).toEqual(groupsBefore);
    expect(await database().table('asset_group_members').whereIn('asset_id', [inTeam, outOfTeam])).toHaveLength(0);
    expect(await assetState([inTeam, outOfTeam])).toEqual(createAssetsBefore);
    expect(await assignmentState([inTeam, outOfTeam])).toEqual(createAssignmentsBefore);

    const created = await createAssetGroup({ clientId, name: 'Authorized group', kind: 'bundle', assetIds: [inTeam] });
    expect(created).toMatchObject({ name: 'Authorized group' });
    const groupId = (created as any).group_id as string;
    const secondInTeam = await createAsset('Second in-team asset');
    await assignAssetToTeam(secondInTeam);

    const addAssetsBefore = await assetState([secondInTeam, outOfTeam]);
    const addAssignmentsBefore = await assignmentState([secondInTeam, outOfTeam]);
    const deniedAdd = await addAssetsToGroup(groupId, [secondInTeam, outOfTeam]);
    expect(deniedAdd).toHaveProperty('permissionError');
    expect(await database().table('asset_group_members').whereIn('asset_id', [secondInTeam, outOfTeam])).toHaveLength(0);
    expect(await assetState([secondInTeam, outOfTeam])).toEqual(addAssetsBefore);
    expect(await assignmentState([secondInTeam, outOfTeam])).toEqual(addAssignmentsBefore);

    const allowedAdd = await addAssetsToGroup(groupId, [secondInTeam]);
    expect(allowedAdd).toMatchObject({ group_id: groupId });
    expect(await database().table('asset_group_members').where({ asset_id: secondInTeam, group_id: groupId })).toHaveLength(1);

    await expect(setAssetGroupOwner(groupId, oldOwnerId)).resolves.toMatchObject({ group_id: groupId });
    const allowedUpdate = await updateAssetGroup(groupId, { locationId });
    expect(allowedUpdate).toMatchObject({ group_id: groupId, location_id: locationId });
    expect(await database().table('assets').whereIn('asset_id', [inTeam, secondInTeam]).pluck('location_id')).toEqual([locationId, locationId]);

    await database().table('asset_group_members').insert({ tenant: holder.tenant, group_id: groupId, asset_id: outOfTeam });
    expect(await removeAssetFromGroup(groupId, outOfTeam)).toHaveProperty('permissionError');
    expect(await removeAssetFromGroup(groupId, randomUUID())).toMatchObject({ group_id: groupId });
    const beforeLocation = await database().table('assets').whereIn('asset_id', [inTeam, secondInTeam, outOfTeam]).select('asset_id', 'location_id', 'location', 'contact_name_id');
    const beforeAssignments = await assignmentState([inTeam, secondInTeam, outOfTeam]);
    const beforeOwner = await database().table('asset_group_contacts').where({ group_id: groupId, role: 'owner' }).first('contact_name_id');

    const deniedUpdate = await updateAssetGroup(groupId, { locationId: null, description: 'must roll back' });
    expect(deniedUpdate).toHaveProperty('permissionError');
    const deniedOwnerChange = await setAssetGroupOwner(groupId, newOwnerId);
    expect(deniedOwnerChange).toHaveProperty('permissionError');
    const deniedDelete = await deleteAssetGroup(groupId);
    expect(deniedDelete).toHaveProperty('permissionError');

    expect(await database().table('asset_groups').where({ group_id: groupId }).first('location_id', 'description')).toMatchObject({ location_id: locationId, description: null });
    expect(await database().table('asset_group_members').where({ group_id: groupId }).pluck('asset_id')).toEqual(expect.arrayContaining([inTeam, secondInTeam, outOfTeam]));
    expect(await database().table('asset_group_contacts').where({ group_id: groupId, role: 'owner' }).first('contact_name_id')).toEqual(beforeOwner);
    expect(await database().table('assets').whereIn('asset_id', [inTeam, secondInTeam, outOfTeam]).select('asset_id', 'location_id', 'location', 'contact_name_id')).toEqual(beforeLocation);
    expect(await assignmentState([inTeam, secondInTeam, outOfTeam])).toEqual(beforeAssignments);
  });
});
