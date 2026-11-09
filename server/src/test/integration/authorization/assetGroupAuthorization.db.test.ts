import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const holder = vi.hoisted(() => ({ knex: undefined as unknown as Knex, tenant: '', userId: '' }));
const apiAccess = vi.hoisted(() => ({ permissions: new Set<string>(), principalUserId: '', principalPermissions: new Set<string>() }));

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
vi.mock('../../../../../server/src/lib/api/utils/requestContext', () => ({
  requireRequestContext: () => ({
    tenant: holder.tenant,
    userId: holder.userId,
    user: { user_id: holder.userId, tenant: holder.tenant, user_type: 'internal' },
    viaPrincipalUserId: apiAccess.principalUserId || undefined,
  }),
}));
vi.mock('../../../../../server/src/lib/auth/rbac', () => ({
  hasPermission: async (user: { user_id: string }, resource: string, action: string) =>
    (user.user_id === apiAccess.principalUserId ? apiAccess.principalPermissions : apiAccess.permissions).has(`${resource}:${action}`),
}));
vi.mock('@alga-psa/users/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findUserByIdForApi: async (userId: string) => ({ user_id: userId, tenant: holder.tenant, user_type: 'internal' }),
}));
vi.mock('../../../../../server/src/lib/db/db', () => ({ getConnection: async () => holder.knex }));

import {
  addAssetsToGroup,
  createAssetGroup,
  deleteAssetGroup,
  removeAssetFromGroup,
  setAssetGroupOwner,
  updateAssetGroup,
} from '../../../../../packages/assets/src/actions/assetGroupActions';
import { createAssetReadContext, isAssetActionAllowed, resolveAssetAuthorizationRecords } from '../../../../../packages/assets/src/lib/assetReadAuthorization';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../../../../../packages/inventory/src/test-utils/inventoryTestDatabase';
import { wireLocalTestDbEnv } from '../../../../../server/test-utils/dbConfig';
import { tenantDb } from '@alga-psa/db';
import { NextRequest } from 'next/server';
import { ApiAssetGroupController } from '../../../../../server/src/lib/api/controllers/ApiAssetGroupController';
import {
  addAssetsToGroupRows,
  createGroup,
  updateGroupRow,
} from '../../../../../packages/assets/src/lib/assetGroups';
import { lockAndAuthorizeAssetGroupMembers } from '../../../../../packages/assets/src/lib/assetGroupAuthorization';

const database = (tenant = holder.tenant) => tenantDb(holder.knex, tenant);

describe('asset group mutation authorization', () => {
  let clientId: string;
  let excludedClientId: string;
  let teamId: string;
  let locationId: string;
  let oldOwnerId: string;
  let newOwnerId: string;

  async function createAsset(name: string, assetClientId = clientId): Promise<string> {
    const assetId = randomUUID();
    await database().table('assets').insert({
      tenant: holder.tenant,
      asset_id: assetId,
      asset_type: 'unknown',
      client_id: assetClientId,
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
    excludedClientId = randomUUID();
    await database().table('clients').insert({
      tenant: holder.tenant,
      client_id: excludedClientId,
      client_name: 'Outside the operator client scope',
    });
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

  it('denies empty-member mutations outside the group client scope', async () => {
    const before = await database().table('asset_groups').count('* as count').first();
    expect(await createAssetGroup({ clientId: excludedClientId, name: 'Denied empty group', kind: 'bundle', assetIds: [] }))
      .toHaveProperty('permissionError');
    expect(await database().table('asset_groups').count('* as count').first()).toEqual(before);

    const group = await holder.knex.transaction((trx) => createGroup(trx, holder.tenant, {
      clientId: excludedClientId, name: 'Existing excluded empty group', kind: 'shared_workspace',
    }));
    expect(await addAssetsToGroup(group.group_id, [])).toHaveProperty('permissionError');
    expect(await updateAssetGroup(group.group_id, { name: 'Must not change' })).toHaveProperty('permissionError');
    expect(await removeAssetFromGroup(group.group_id, randomUUID())).toHaveProperty('permissionError');
    expect(await deleteAssetGroup(group.group_id)).toHaveProperty('permissionError');
    expect(await database().table('asset_groups').where({ group_id: group.group_id }).first()).toMatchObject({
      group_id: group.group_id, client_id: excludedClientId, name: group.name, kind: group.kind,
    });
    expect(await database().table('asset_group_members').where({ group_id: group.group_id })).toHaveLength(0);
  });

  it('allows an empty member set as a no-op within the group client scope', async () => {
    const created = await createAssetGroup({ clientId, name: 'Authorized empty group', kind: 'bundle', assetIds: [] });
    expect(created).toMatchObject({ name: 'Authorized empty group' });
    const groupId = (created as { group_id: string }).group_id;
    const before = await database().table('asset_groups').where({ group_id: groupId }).first();
    const historyBefore = await database().table('asset_history').count('* as count').first();

    expect(await addAssetsToGroup(groupId, [])).toMatchObject({ group_id: groupId });
    expect(await database().table('asset_groups').where({ group_id: groupId }).first()).toEqual(before);
    expect(await database().table('asset_group_members').where({ group_id: groupId })).toHaveLength(0);
    expect(await database().table('asset_history').count('* as count').first()).toEqual(historyBefore);
  });

  it('denies a same-team member whose client matches the group but is outside the group client scope', async () => {
    const assetId = await createAsset('Matching client without scope', excludedClientId);
    await assignAssetToTeam(assetId);
    const context = await createAssetReadContext(holder.knex, holder.tenant, { user_id: holder.userId, user_type: 'internal' });
    const record = { asset_id: assetId, client_id: excludedClientId };
    const records = await resolveAssetAuthorizationRecords(holder.knex, holder.tenant, [record]);
    // The update rule alone allows the team, but mutations also need read visibility.
    expect(await context.authorizationKernel.authorizeResource({
      subject: context.subject,
      resource: { type: 'asset', action: 'update', id: assetId },
      record: records.get(assetId),
      requestCache: context.requestCache,
      knex: holder.knex,
    })).toHaveProperty('allowed', true);
    expect(await isAssetActionAllowed(holder.knex, holder.tenant, context, record, 'update')).toBe(false);
    expect(await isAssetActionAllowed(holder.knex, holder.tenant, context, record, 'read')).toBe(false);
    const group = await holder.knex.transaction((trx) => createGroup(trx, holder.tenant, {
      clientId: excludedClientId, name: 'Matching excluded client', kind: 'bundle',
    }));
    const before = await database().table('assets').where({ asset_id: assetId }).first();

    expect(await createAssetGroup({ clientId: excludedClientId, name: 'Denied matching client', kind: 'bundle', assetIds: [assetId] }))
      .toHaveProperty('permissionError');
    expect(await addAssetsToGroup(group.group_id, [assetId])).toHaveProperty('permissionError');
    expect(await database().table('asset_group_members').where({ asset_id: assetId })).toHaveLength(0);
    expect(await database().table('assets').where({ asset_id: assetId }).first()).toEqual(before);
  });

  it('allows membership when both the group client scope and member update rule authorize it', async () => {
    const assetId = await createAsset('Matching authorized client');
    await assignAssetToTeam(assetId);
    const created = await createAssetGroup({ clientId, name: 'Authorized matching client', kind: 'bundle' });
    expect(created).toMatchObject({ client_id: clientId });
    const groupId = (created as { group_id: string }).group_id;

    expect(await addAssetsToGroup(groupId, [assetId])).toMatchObject({ group_id: groupId });
    expect(await database().table('asset_group_members').where({ group_id: groupId, asset_id: assetId })).toHaveLength(1);
  });

  it('requires update permission and client scope for empty API groups', async () => {
    const controller = new ApiAssetGroupController();
    const create = (groupClientId: string) => controller.create(new NextRequest('http://localhost/api/v1/asset-groups', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: groupClientId, name: 'Empty API group', kind: 'bundle', asset_ids: [] }),
    }));
    const before = await database().table('asset_groups').count('* as count').first();
    try {
      apiAccess.permissions = new Set(['asset:create']);
      expect((await create(clientId)).status).toBe(403);
      apiAccess.permissions = new Set(['asset:create', 'asset:update']);
      expect((await create(excludedClientId)).status).toBe(403);
      expect(await database().table('asset_groups').count('* as count').first()).toEqual(before);
      const allowed = await create(clientId);
      expect(allowed.status).toBe(200);
      const { data: group } = await allowed.json();
      const remove = () => controller.delete(new NextRequest(`http://localhost/api/v1/asset-groups/${group.group_id}`, {
        method: 'DELETE',
      }), { id: group.group_id });
      apiAccess.permissions = new Set(['asset:delete']);
      expect((await remove()).status).toBe(403);
      expect(await database().table('asset_groups').where({ group_id: group.group_id })).toHaveLength(1);
      apiAccess.permissions = new Set(['asset:delete', 'asset:update']);
      expect((await remove()).status).toBe(200);
      expect(await database().table('asset_groups').where({ group_id: group.group_id })).toHaveLength(0);
    } finally {
      apiAccess.permissions.clear();
    }
  });

  it('requires both delegated API actors to hold update permission for group creation and deletion', async () => {
    const controller = new ApiAssetGroupController();
    const create = () => controller.create(new NextRequest('http://localhost/api/v1/asset-groups', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, name: 'Delegated API group', kind: 'bundle' }),
    }));
    const before = await database().table('asset_groups').count('* as count').first();
    const routePermissions = ['asset:create', 'asset:delete'];
    try {
      apiAccess.principalUserId = randomUUID();
      apiAccess.permissions = new Set([...routePermissions, 'asset:update']);
      apiAccess.principalPermissions = new Set(routePermissions);
      expect((await create()).status).toBe(403);
      apiAccess.permissions = new Set(routePermissions);
      apiAccess.principalPermissions.add('asset:update');
      expect((await create()).status).toBe(403);
      expect(await database().table('asset_groups').count('* as count').first()).toEqual(before);

      apiAccess.permissions.add('asset:update');
      const created = await create();
      expect(created.status).toBe(200);
      const { data: group } = await created.json();
      const remove = () => controller.delete(new NextRequest(`http://localhost/api/v1/asset-groups/${group.group_id}`, {
        method: 'DELETE',
      }), { id: group.group_id });
      apiAccess.principalPermissions.delete('asset:update');
      expect((await remove()).status).toBe(403);
      apiAccess.principalPermissions.add('asset:update');
      apiAccess.permissions.delete('asset:update');
      expect((await remove()).status).toBe(403);
      expect(await database().table('asset_groups').where({ group_id: group.group_id })).toHaveLength(1);

      apiAccess.permissions.add('asset:update');
      expect((await remove()).status).toBe(200);
      expect(await database().table('asset_groups').where({ group_id: group.group_id })).toHaveLength(0);
    } finally {
      apiAccess.principalUserId = '';
      apiAccess.permissions.clear();
      apiAccess.principalPermissions.clear();
    }
  });

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
    expect(await removeAssetFromGroup(groupId, randomUUID())).toHaveProperty('permissionError');
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

  it('allows in-scope removal but denies every removal target once the group has a restricted member', async () => {
    const inTeam = await createAsset('Removable in-team asset');
    const outOfTeam = await createAsset('Restricted removal group member');
    await assignAssetToTeam(inTeam);
    const created = await createAssetGroup({ clientId, name: 'Removal authorization group', kind: 'bundle', assetIds: [inTeam] });
    expect(created).toMatchObject({ name: 'Removal authorization group' });
    const groupId = (created as { group_id: string }).group_id;

    expect(await removeAssetFromGroup(groupId, inTeam)).toMatchObject({ group_id: groupId, members: [] });
    expect(await database().table('asset_group_members').where({ group_id: groupId })).toHaveLength(0);
    expect(await addAssetsToGroup(groupId, [inTeam])).toMatchObject({ group_id: groupId });
    await database().table('asset_group_members').insert({ tenant: holder.tenant, group_id: groupId, asset_id: outOfTeam });

    const state = async () => ({
      group: await database().table('asset_groups').where({ group_id: groupId }).first(),
      members: await database().table('asset_group_members').where({ group_id: groupId }).orderBy('asset_id'),
      assets: await database().table('assets').whereIn('asset_id', [inTeam, outOfTeam]).orderBy('asset_id'),
      assignments: await database().table('asset_assignments').whereIn('asset_id', [inTeam, outOfTeam]).orderBy('assignment_id'),
      history: await database().table('asset_history').whereIn('asset_id', [inTeam, outOfTeam]).count('* as count').first(),
    });
    const before = await state();
    for (const assetId of [inTeam, outOfTeam, randomUUID()]) {
      expect(await removeAssetFromGroup(groupId, assetId)).toEqual({
        permissionError: 'Permission denied: Cannot update assets',
        messageKey: 'msp/assets:errors.permissions.updateAssets',
      });
      expect(await state()).toEqual(before);
    }
  });

  it('serializes membership insertion behind the update authorization and propagation transaction', async () => {
    const inTeam = await createAsset('In-team concurrency member');
    const outOfTeam = await createAsset('Out-of-team concurrency member');
    await assignAssetToTeam(inTeam);

    const group = await holder.knex.transaction(async (trx) => {
      const created = await createGroup(trx, holder.tenant, { clientId, name: 'Serialized group', kind: 'shared_workspace' });
      await addAssetsToGroupRows(trx, holder.tenant, created.group_id, [inTeam]);
      return created;
    });

    let authorized!: () => void;
    let continuePropagation!: () => void;
    const authorizationReached = new Promise<void>((resolve) => { authorized = resolve; });
    const propagationGate = new Promise<void>((resolve) => { continuePropagation = resolve; });
    const updateTransaction = holder.knex.transaction(async (trx) => {
      await lockAndAuthorizeAssetGroupMembers(trx, holder.tenant, { user_id: holder.userId, user_type: 'internal' }, group.group_id);
      authorized();
      await propagationGate;
      await updateGroupRow(trx, holder.tenant, group.group_id, { locationId });
    });

    await authorizationReached;
    let writerPid!: number;
    let writerStarted!: () => void;
    const writerHasPid = new Promise<void>((resolve) => { writerStarted = resolve; });
    let writerSettled = false;
    const membershipTransaction = holder.knex.transaction(async (trx) => {
      const result = await trx.raw('select pg_backend_pid() as pid');
      writerPid = Number(result.rows[0].pid);
      writerStarted();
      await addAssetsToGroupRows(trx, holder.tenant, group.group_id, [outOfTeam]);
    }).finally(() => { writerSettled = true; });

    try {
      await writerHasPid;
      let writerBlocked = false;
      const deadline = Date.now() + 5_000;
      while (!writerBlocked && !writerSettled && Date.now() < deadline) {
        const result = await holder.knex.raw('select pg_blocking_pids(?::int) as blockers', [writerPid]);
        writerBlocked = (result.rows[0].blockers as number[]).length > 0;
        if (!writerBlocked && !writerSettled) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(writerBlocked, 'membership writer should wait on the group row lock').toBe(true);
    } finally {
      continuePropagation();
    }

    await Promise.all([updateTransaction, membershipTransaction]);
    expect(await database().table('assets').where({ asset_id: outOfTeam }).first('location_id')).toEqual({ location_id: null });
    expect(await database().table('asset_group_members').where({ group_id: group.group_id, asset_id: outOfTeam })).toHaveLength(1);
  });

  it('requires coarse asset:update for API membership creation and deletion while preserving their route permissions', async () => {
    const assetId = await createAsset('API permission asset');
    await assignAssetToTeam(assetId);
    const body = JSON.stringify({ client_id: clientId, name: 'API create gate', kind: 'bundle', location_id: locationId, asset_ids: [assetId] });
    const controller = new ApiAssetGroupController();
    const groupsBefore = await database().table('asset_groups').count('* as count').first();
    const assetsBefore = await database().table('assets').where({ asset_id: assetId }).first('location_id', 'location', 'contact_name_id');

    apiAccess.permissions = new Set(['asset:create']);
    const deniedCreate = await controller.create(new NextRequest('http://localhost/api/v1/asset-groups', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }));
    expect(deniedCreate.status).toBe(403);
    expect(await database().table('asset_groups').count('* as count').first()).toEqual(groupsBefore);
    expect(await database().table('asset_group_members').where({ asset_id: assetId })).toHaveLength(0);
    expect(await database().table('assets').where({ asset_id: assetId }).first('location_id', 'location', 'contact_name_id')).toEqual(assetsBefore);

    apiAccess.permissions = new Set(['asset:create', 'asset:update']);
    const allowedCreate = await controller.create(new NextRequest('http://localhost/api/v1/asset-groups', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }));
    expect(allowedCreate.status).toBe(200);
    const createdBody = await allowedCreate.json();
    const groupId = createdBody.data.group_id as string;
    expect(await database().table('asset_group_members').where({ group_id: groupId, asset_id: assetId })).toHaveLength(1);

    apiAccess.permissions = new Set(['asset:delete']);
    const deniedDelete = await controller.delete(new NextRequest(`http://localhost/api/v1/asset-groups/${groupId}`, { method: 'DELETE' }), { id: groupId });
    expect(deniedDelete.status).toBe(403);
    expect(await database().table('asset_groups').where({ group_id: groupId })).toHaveLength(1);
    expect(await database().table('asset_group_members').where({ group_id: groupId, asset_id: assetId })).toHaveLength(1);

    apiAccess.permissions = new Set(['asset:delete', 'asset:update']);
    const allowedDelete = await controller.delete(new NextRequest(`http://localhost/api/v1/asset-groups/${groupId}`, { method: 'DELETE' }), { id: groupId });
    expect(allowedDelete.status).toBe(200);
    expect(await database().table('asset_groups').where({ group_id: groupId })).toHaveLength(0);
    expect(await database().table('asset_group_members').where({ group_id: groupId })).toHaveLength(0);
    apiAccess.permissions.clear();
  });
});
