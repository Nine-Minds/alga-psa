/**
 * Co-managed seat shape, slice S30 (F074, F075 / T039) on real Postgres.
 *
 * A seat technician lists and opens their own client's devices, RMM inventory included, read-only: no
 * purchase cost, no billing profile, no remote access, no script or RMM write, no asset write. Another
 * client's device answers "not found". They can link their client's device to a ticket they can work and
 * create a ticket from it.
 *
 * Two seat technicians are used. `tech` holds exactly the seat role. `widened` holds the seat role plus
 * every asset write and RMM permission an administrator could have added: what still holds for them is
 * the seat authority itself, not the role.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any, user: null as any, tenant: '' }));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (fn: any) => (...args: any[]) => fn(holder.user, { tenant: holder.tenant }, ...args),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: holder.db, tenant: holder.tenant }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishWorkflowEvent: async () => undefined,
  publishNonCatalogWorkflowEvent: async () => undefined,
}));

import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope, CO_MANAGED_SEAT_ROLE_GRANTS } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID, coManagedSeatResolver } from '@alga-psa/co-managed/seatAuthority';
import { registerBuiltinRuleResolver } from '@alga-psa/authorization/kernel';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import {
  bulkDeleteAssets, bulkUpdateAssets, createAsset, createAssetAssociation, createAssetRelationship, deleteAsset,
  getAsset, getAssetDetailBundle, getAssetHistory, getAssetSurfaceAccess, linkAssetToTicket, listAssets,
  removeAssetAssociation, updateAsset,
} from '@alga-psa/assets/actions/assetActions';
import {
  deleteRemoteAccessLink, getRemoteAccessLinksForAsset, hasRemoteAccessLinks, saveRemoteAccessLink,
} from '@alga-psa/assets/actions/remoteAccessLinkActions';
import { mapRmmUserToContact, suggestAssigneeFromRmmUser } from '@alga-psa/assets/actions/rmmUserAssignmentActions';
import { getAssetInventoryProvenance } from '@alga-psa/assets/actions/assetInventoryActions';
import {
  getAssetRemoteControlTypes, getAssetRemoteControlUrl, getAssetRmmData, refreshAssetRmmData, triggerRmmReboot,
  triggerRmmScript,
} from '@alga-psa/integrations/actions/integrations/assetRmmActions';
import { createTicketFromAsset } from '@alga-psa/tickets/actions/ticketActions';
import { AssetService } from '../../lib/api/services/AssetService';
import { authorizeApiResource } from '../../lib/api/controllers/authorizationKernel';
import { insertTestAssets } from '../../../../shared/test-utils/assetFixtures';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

const COST = 123_456;
const BILLING_PROFILE_NAME = 'Quarterly device lease';
const COMMERCIAL_KEYS = ['purchase_cost', 'purchase_cost_currency', 'billing_profile_id', 'billing_profile_name'];

const asRecord = (value: unknown) => value as Record<string, any>;
/** An expected action error ({ permissionError } or { actionError }) as its message, or null for a success. */
const failureOf = (result: unknown): string | null => {
  const r = asRecord(result);
  if (r && typeof r.permissionError === 'string') return r.permissionError;
  if (r && typeof r.actionError === 'string') return r.actionError;
  return null;
};
/** What an action did when called: its failure message (returned or thrown), or null when it succeeded. */
const attempt = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    const result = await run();
    const failure = failureOf(result);
    if (failure) return failure;
    const r = asRecord(result);
    if (r && r.success === false) return String(r.message ?? 'failed');
    // A bulk action reports per asset: nothing succeeded is a refusal.
    if (r && Array.isArray(r.results) && r.succeeded === 0) return String(r.results[0]?.error ?? 'bulk action refused');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describeDb('co-managed seat devices: read-only own-client assets on real Postgres', { shuffle: false }, () => {
  let db: Knex;
  let tenant: string;
  let ownClient: string;
  let otherClient: string;
  let boardA: string;      // in scope, creatable
  let boardOther: string;  // not in scope
  let statusId: string;
  let priorityId: string;
  let ownAsset: string;
  let otherAsset: string;
  let visibleTicket: string;
  let hiddenBoardTicket: string;
  let otherClientTicket: string;
  let tech: any;
  let widened: any;
  let msp: any;
  const queries: string[] = [];

  const roleFor = async (permissions: Array<[string, string]>) => {
    const userId = await createUser(db, tenant, { user_type: 'internal' });
    const roleId = randomUUID();
    await db('roles').insert({ tenant, role_id: roleId, role_name: `role-${roleId.slice(0, 8)}`, msp: true, client: false });
    for (const [resource, action] of permissions) {
      const permission = await db('permissions').where({ tenant, resource, action, msp: true }).first('permission_id');
      const permissionId = permission?.permission_id ?? randomUUID();
      if (!permission) await db('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
    }
    await db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    return userId;
  };
  const makeSeat = async (arrangementId: string, extra: Array<[string, string]> = []) => {
    const grants = CO_MANAGED_SEAT_ROLE_GRANTS.map((grant) => grant.split(':') as [string, string]);
    const userId = await roleFor([...grants, ...extra]);
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({
        tenant, assignment_id: randomUUID(), arrangement_id: arrangementId, user_id: userId, state: 'active',
      });
    });
    return db('users').where({ tenant, user_id: userId }).first();
  };
  const ticket = async (clientId: string, boardId: string, title: string) => {
    const ticketId = randomUUID();
    await db('tickets').insert({
      tenant, ticket_id: ticketId, ticket_number: `T039-${ticketId.slice(0, 8)}`, title, client_id: clientId, board_id: boardId,
      status_id: statusId, priority_id: priorityId, entered_by: msp.user_id, entered_at: db.fn.now(), updated_at: db.fn.now(),
    });
    return ticketId;
  };
  const as = (user: any) => { holder.user = user; };
  const linkCount = async (assetId: string, ticketId: string) =>
    Number((await db('asset_associations').where({ tenant, asset_id: assetId, entity_id: ticketId, entity_type: 'ticket' }).count('* as n').first())!.n);

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:on';
    db = await createTestDbConnection({ databaseName: 's30_seat_devices_test' });
    holder.db = db;
    registerBuiltinRuleResolver(coManagedSeatResolver);

    tenant = await createTenant(db, `Seat devices sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    holder.tenant = tenant;
    await db('co_managed_entitlements').insert({
      tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY),
    });
    ownClient = await createClient(db, tenant, `Seat client ${randomUUID().slice(0, 8)}`);
    otherClient = await createClient(db, tenant, `Other client ${randomUUID().slice(0, 8)}`);
    boardA = randomUUID(); boardOther = randomUUID();
    await db('boards').insert([
      { tenant, board_id: boardA, board_name: `Seat board ${boardA.slice(0, 6)}`, is_default: false },
      { tenant, board_id: boardOther, board_name: `MSP board ${boardOther.slice(0, 6)}`, is_default: false },
    ]);
    statusId = randomUUID(); priorityId = randomUUID();
    await db('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Normal', item_type: 'ticket', color: '#3B82F6', order_number: 1 });
    await db('statuses').insert({ tenant, status_id: statusId, board_id: boardA, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 1 });

    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: ownClient, operationId: randomUUID(), seats: 3 });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId: arrangement.arrangement_id, boards: [{ boardId: boardA, canCreate: true }] });
    tech = await makeSeat(arrangement.arrangement_id);
    widened = await makeSeat(arrangement.arrangement_id, [
      ['asset', 'create'], ['asset', 'update'], ['asset', 'delete'], ['system_settings', 'read'], ['system_settings', 'update'],
      ['rmm', 'execute_command'],
    ]);
    const mspId = await roleFor([
      ['asset', 'read'], ['asset', 'create'], ['asset', 'update'], ['asset', 'delete'], ['ticket', 'read'], ['ticket', 'create'],
      ['ticket', 'update'], ['client', 'read'], ['system_settings', 'read'], ['system_settings', 'update'],
    ]);
    msp = await db('users').where({ tenant, user_id: mspId }).first();

    const profile = await db('client_billing_profiles').where({ tenant, client_id: ownClient }).first('billing_profile_id');
    const profileId = profile?.billing_profile_id ?? randomUUID();
    if (profile) await db('client_billing_profiles').where({ tenant, billing_profile_id: profileId }).update({ name: BILLING_PROFILE_NAME });
    else await db('client_billing_profiles').insert({ tenant, billing_profile_id: profileId, client_id: ownClient, name: BILLING_PROFILE_NAME, is_default: true });

    const now = new Date().toISOString();
    ownAsset = randomUUID(); otherAsset = randomUUID();
    await insertTestAssets(db, [
      {
        tenant, asset_id: ownAsset, asset_type: 'workstation', client_id: ownClient, asset_tag: `S30-${ownAsset.slice(0, 8)}`,
        name: 'Front desk PC', serial_number: 'SN-FRONT', status: 'active', location: 'Front desk', created_at: now, updated_at: now,
        rmm_provider: 'tacticalrmm', rmm_device_id: 'dev-1', agent_status: 'online', last_seen_at: now, last_rmm_sync_at: now,
        purchase_cost: COST, purchase_cost_currency: 'EUR', billing_profile_id: profileId,
      },
      {
        tenant, asset_id: otherAsset, asset_type: 'workstation', client_id: otherClient, asset_tag: `S30-${otherAsset.slice(0, 8)}`,
        name: 'Other client PC', serial_number: 'SN-OTHER', status: 'active', location: 'Elsewhere', created_at: now, updated_at: now,
        purchase_cost: 99_900, purchase_cost_currency: 'USD',
      },
    ]);
    await db('workstation_assets').insert({
      tenant, asset_id: ownAsset, os_type: 'Windows', os_version: '11 Pro', cpu_model: 'i7-1370P', cpu_cores: 12, ram_gb: 32,
      lan_ip: '10.0.0.21', wan_ip: '203.0.113.9', current_user: 'frontdesk', uptime_seconds: 86_400,
    });
    await db('asset_history').insert({
      tenant, asset_id: ownAsset, changed_by: msp.user_id, change_type: 'updated', changed_at: now,
      changes: { name: 'Front desk PC', purchase_cost: COST, billing_profile_id: profileId },
    });
    await db('asset_remote_access_links').insert({ tenant, link_id: randomUUID(), label: 'Console', url_template: 'https://remote.example.com/{asset.name}' })
      .catch(() => undefined);

    visibleTicket = await ticket(ownClient, boardA, 'Printer offline');
    hiddenBoardTicket = await ticket(ownClient, boardOther, 'MSP internal board ticket');
    otherClientTicket = await ticket(otherClient, boardA, 'Other client ticket');
    db.on('query', (q: { sql: string }) => { queries.push(q.sql); });
  }, 300_000);
  afterAll(async () => {
    db?.removeAllListeners('query');
    await db?.destroy();
  });
  beforeEach(() => { process.env.FORCE_CAPABILITIES = 'co-managed-seat:on'; });

  // F074
  it('opens an own-client asset with its RMM inventory and no commercial field', async () => {
    as(tech);
    queries.length = 0;
    const bundle = asRecord(await getAssetDetailBundle(ownAsset));
    const asset = asRecord(bundle.asset);
    expect(asset.asset_id).toBe(ownAsset);
    expect(asset).toMatchObject({ name: 'Front desk PC', rmm_provider: 'tacticalrmm', agent_status: 'online', serial_number: 'SN-FRONT' });
    expect(asset.workstation).toMatchObject({ os_type: 'Windows', ram_gb: 32, lan_ip: '10.0.0.21', current_user: 'frontdesk' });
    for (const key of COMMERCIAL_KEYS) expect(asset, key).not.toHaveProperty(key);
    expect(JSON.stringify(bundle)).not.toContain(BILLING_PROFILE_NAME);
    expect(JSON.stringify(bundle)).not.toContain(String(COST));

    // The commercial data never left the database: no statement of this read named it.
    const statements = queries.join('\n');
    expect(statements).not.toMatch(/client_billing_profiles/);
    expect(statements).not.toMatch(/purchase_cost/);
    expect(statements).not.toMatch(/billing_profile_id/);

    const plain = asRecord(await getAsset(ownAsset));
    for (const key of COMMERCIAL_KEYS) expect(plain, key).not.toHaveProperty(key);
    expect(plain.workstation).toMatchObject({ os_type: 'Windows' });

    const rmm = asRecord(await getAssetRmmData(ownAsset));
    expect(rmm).toMatchObject({ provider: 'tacticalrmm', agent_status: 'online', lan_ip: '10.0.0.21' });
    expect(await getAssetInventoryProvenance(ownAsset)).toBeTruthy();
  });

  it('lists only the own client\'s assets, with no commercial field in the rows', async () => {
    as(tech);
    queries.length = 0;
    const list = asRecord(await listAssets({}));
    expect(list.assets.map((a: any) => a.asset_id)).toEqual([ownAsset]);
    for (const key of COMMERCIAL_KEYS) expect(list.assets[0], key).not.toHaveProperty(key);
    expect(JSON.stringify(list)).not.toContain(String(COST));
    expect(queries.join('\n')).not.toMatch(/purchase_cost/);
  });

  it('leaves the closed fields out of the asset\'s change history', async () => {
    as(tech);
    const history = (await getAssetHistory(ownAsset)) as any[];
    expect(history.length).toBeGreaterThan(0);
    for (const entry of history) {
      expect(entry.changes).not.toHaveProperty('purchase_cost');
      expect(entry.changes).not.toHaveProperty('billing_profile_id');
    }
    expect(history[0].changes).toMatchObject({ name: 'Front desk PC' });
  });

  it('answers not found, not forbidden, for another client\'s asset', async () => {
    for (const user of [tech, widened]) {
      as(user);
      for (const read of [() => getAsset(otherAsset), () => getAssetDetailBundle(otherAsset), () => getAssetHistory(otherAsset)]) {
        const failure = await attempt(read);
        expect(failure, 'read of another client asset').toMatch(/not found/i);
        expect(failure).not.toMatch(/permission denied|forbidden/i);
      }
    }
  });

  it('closes every asset write, whatever the role holds', async () => {
    const data = { client_id: ownClient, name: 'New PC', asset_type: 'workstation', asset_tag: `S30-NEW-${randomUUID().slice(0, 6)}`, status: 'active' } as any;
    for (const user of [tech, widened]) {
      as(user);
      const label = user === tech ? 'seat role' : 'widened role';
      expect(await attempt(() => createAsset(data)), `createAsset (${label})`).toMatch(/denied|permission/i);
      expect(await attempt(() => updateAsset(ownAsset, { name: 'Renamed' } as any)), `updateAsset (${label})`).toMatch(/denied|permission|not found/i);
      expect(await attempt(() => deleteAsset(ownAsset)), `deleteAsset (${label})`).not.toBeNull();
      expect(await attempt(() => bulkUpdateAssets([ownAsset], { status: 'inactive' } as any)), `bulkUpdateAssets (${label})`).not.toBeNull();
      expect(await attempt(() => bulkDeleteAssets([ownAsset])), `bulkDeleteAssets (${label})`).not.toBeNull();
      expect(await attempt(() => createAssetRelationship({ parent_asset_id: ownAsset, child_asset_id: ownAsset, relationship_type: 'connected_to' } as any)), `relationship (${label})`).not.toBeNull();
      expect(await attempt(() => createAssetAssociation({ asset_id: ownAsset, entity_id: visibleTicket, entity_type: 'ticket', relationship_type: 'affected' })), `createAssetAssociation (${label})`).not.toBeNull();
      expect(await attempt(() => removeAssetAssociation(ownAsset, visibleTicket, 'ticket')), `removeAssetAssociation (${label})`).not.toBeNull();
    }
    const row = await db('assets').where({ tenant, asset_id: ownAsset }).first('name');
    expect(row.name).toBe('Front desk PC');
    expect(await linkCount(ownAsset, visibleTicket)).toBe(0);
  });

  it('closes remote access, scripts and every RMM write', async () => {
    for (const user of [tech, widened]) {
      as(user);
      const label = user === tech ? 'seat role' : 'widened role';
      expect(await getRemoteAccessLinksForAsset(ownAsset), `links for asset (${label})`).toEqual([]);
      expect(await hasRemoteAccessLinks(), `has links (${label})`).toBe(false);
      expect(await getAssetRemoteControlTypes(ownAsset), `control types (${label})`).toEqual([]);
      expect(await attempt(() => getAssetRemoteControlUrl(ownAsset, 'splashtop')), `control url (${label})`).toMatch(/denied/i);
      expect(await attempt(() => triggerRmmReboot(ownAsset)), `reboot (${label})`).toMatch(/denied/i);
      expect(await attempt(() => triggerRmmScript(ownAsset, 'script-1')), `script (${label})`).toMatch(/denied/i);
      expect(await attempt(() => refreshAssetRmmData(ownAsset)), `refresh (${label})`).toMatch(/denied/i);
      expect(await attempt(() => mapRmmUserToContact({ integrationId: randomUUID(), provider: 'tacticalrmm', rawUser: 'frontdesk', contactId: null, assignAssetId: ownAsset })), `map user (${label})`).toMatch(/denied|permission/i);
      expect(await attempt(() => suggestAssigneeFromRmmUser(ownAsset)), `suggest user (${label})`).not.toBeNull();
    }
    // Managing the remote-access templates is settings work. The seat role holds no settings permission, and
    // the seat authority has no settings resource to close for a technician whose role was widened (LEVERAGE marker).
    as(tech);
    expect(await attempt(() => saveRemoteAccessLink({ label: 'X', url_template: 'https://x.example.com/{asset.name}' })), 'save link').toMatch(/denied|permission/i);
    expect(await attempt(() => deleteRemoteAccessLink(randomUUID())), 'delete link').toMatch(/denied|permission/i);
  });

  it('tells the screens what is closed, and nothing for MSP staff', async () => {
    as(tech);
    expect(await getAssetSurfaceAccess()).toEqual({
      closedActions: ['create', 'update', 'delete'],
      closedOperations: ['remote_access', 'rmm_command', 'rmm_mapping', 'rmm_refresh'],
      closedFields: ['billing_profile_id', 'billing_profile_name', 'purchase_cost', 'purchase_cost_currency'],
    });
    as(msp);
    expect(await getAssetSurfaceAccess()).toEqual({ closedActions: [], closedOperations: [], closedFields: [] });
  });

  // F075
  it('links an own-client asset to a ticket they can work', async () => {
    as(tech);
    const association = asRecord(await linkAssetToTicket({ asset_id: ownAsset, ticket_id: visibleTicket }));
    expect(association).toMatchObject({ asset_id: ownAsset, entity_id: visibleTicket, entity_type: 'ticket' });
    expect(await linkCount(ownAsset, visibleTicket)).toBe(1);
    expect(await attempt(() => linkAssetToTicket({ asset_id: ownAsset, ticket_id: visibleTicket }))).toMatch(/already linked/i);
    // The asset side reads it back through the existing association read.
    expect(await linkCount(ownAsset, visibleTicket)).toBe(1);
  });

  it('refuses a ticket they cannot see and an asset of another client', async () => {
    for (const user of [tech, widened]) {
      as(user);
      const hiddenBoard = await attempt(() => linkAssetToTicket({ asset_id: ownAsset, ticket_id: hiddenBoardTicket }));
      expect(hiddenBoard, 'ticket on a board outside the scope').toMatch(/ticket not found/i);
      const otherTicket = await attempt(() => linkAssetToTicket({ asset_id: ownAsset, ticket_id: otherClientTicket }));
      expect(otherTicket, 'ticket of another client').toMatch(/ticket not found/i);
      const otherAssetFailure = await attempt(() => linkAssetToTicket({ asset_id: otherAsset, ticket_id: visibleTicket }));
      expect(otherAssetFailure, 'asset of another client').toMatch(/asset not found/i);
      expect(otherAssetFailure).not.toMatch(/denied|forbidden/i);
    }
    expect(await linkCount(ownAsset, hiddenBoardTicket)).toBe(0);
    expect(await linkCount(ownAsset, otherClientTicket)).toBe(0);
    expect(await linkCount(otherAsset, visibleTicket)).toBe(0);
  });

  it('links nothing while co-managed-seat is not admitted', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:off';
    as(tech);
    const second = await ticket(ownClient, boardA, 'Second ticket');
    expect(await attempt(() => linkAssetToTicket({ asset_id: ownAsset, ticket_id: second }))).toMatch(/asset not found/i);
    expect(await linkCount(ownAsset, second)).toBe(0);
  });

  it('creates a ticket from an own-client asset, on the technician\'s client, linked to the asset', async () => {
    as(tech);
    const created = asRecord(await createTicketFromAsset({
      title: 'Front desk PC will not boot', description: 'Black screen', priority_id: priorityId, status_id: statusId,
      board_id: boardA, asset_id: ownAsset, client_id: ownClient,
    }));
    expect(failureOf(created)).toBeNull();
    expect(created.client_id).toBe(ownClient);
    const row = await db('tickets').where({ tenant, ticket_id: created.ticket_id }).first('client_id', 'board_id');
    expect(row).toMatchObject({ client_id: ownClient, board_id: boardA });
    expect(await linkCount(ownAsset, created.ticket_id)).toBe(1);
  });

  it('refuses to create a ticket from another client\'s asset, or on another client', async () => {
    as(tech);
    const base = { title: 'x', description: 'y', priority_id: priorityId, status_id: statusId, board_id: boardA };
    const fromOtherAsset = await attempt(() => createTicketFromAsset({ ...base, asset_id: otherAsset, client_id: ownClient }));
    expect(fromOtherAsset).toMatch(/not found/i);
    const onOtherClient = await attempt(() => createTicketFromAsset({ ...base, asset_id: otherAsset, client_id: otherClient }));
    expect(onOtherClient).not.toBeNull();
    const onUnscopedBoard = await attempt(() => createTicketFromAsset({ ...base, board_id: boardOther, asset_id: ownAsset, client_id: ownClient }));
    expect(onUnscopedBoard).not.toBeNull();
    expect(await db('asset_associations').where({ tenant, asset_id: otherAsset }).count('* as n').first().then((r) => Number(r!.n))).toBe(0);
  });

  // The REST asset API and the mobile app read through AssetService: the same closed fields apply.
  describe('REST service layer', () => {
    const service = new AssetService();
    const ctx = (user: any) => ({ tenant, userId: user.user_id, user, db } as any);
    const NO_COMMERCIAL = (row: Record<string, unknown>, label: string) => {
      for (const key of COMMERCIAL_KEYS) expect(row, `${label}: ${key}`).not.toHaveProperty(key);
    };

    it('lists, searches and reads an asset without a closed field, leaving it out of the SQL', async () => {
      queries.length = 0;
      const list = await service.list({ page: 1, limit: 25, sort: 'purchase_cost' as any }, ctx(tech));
      expect(list.data.map((a: any) => a.asset_id)).toEqual([ownAsset]);
      NO_COMMERCIAL(list.data[0], 'list');
      const found = await service.search({ query: 'Front', limit: 10 } as any, ctx(tech));
      expect(found.map((a: any) => a.asset_id)).toEqual([ownAsset]);
      NO_COMMERCIAL(found[0], 'search');
      const byId = await service.getById(ownAsset, ctx(tech));
      NO_COMMERCIAL(byId, 'getById');
      const details = await service.getWithDetails(ownAsset, ctx(tech));
      expect(details).toMatchObject({ asset_id: ownAsset, name: 'Front desk PC', rmm_provider: 'tacticalrmm' });
      NO_COMMERCIAL(details, 'getWithDetails');
      expect(JSON.stringify([list, found, byId, details])).not.toContain(String(COST));
      const statements = queries.join('\n');
      expect(statements).not.toMatch(/purchase_cost/);
      expect(statements).not.toMatch(/billing_profile_id/);
      expect(statements).not.toMatch(/client_billing_profiles/);
    });

    it('omits the aggregate asset value rather than reporting 0', async () => {
      queries.length = 0;
      const stats = await service.getStatistics(ctx(tech));
      expect(stats).toMatchObject({ total_assets: 1 });
      expect(stats).not.toHaveProperty('total_asset_value');
      expect(queries.join('\n')).not.toMatch(/purchase_cost/);
    });

    it('gives MSP staff the commercial fields as before', async () => {
      const list = await service.list({ page: 1, limit: 25 }, ctx(msp));
      const row = list.data.find((a: any) => a.asset_id === ownAsset);
      expect(row).toMatchObject({ purchase_cost: expect.anything(), purchase_cost_currency: 'EUR' });
      expect(row.billing_profile_id).toBeTruthy();
      const details = await service.getWithDetails(ownAsset, ctx(msp));
      expect(details).toMatchObject({ purchase_cost: expect.anything() });
      expect(details.billing_profile_id).toBeTruthy();
      const stats = await service.getStatistics(ctx(msp));
      expect(stats.total_asset_value).toBeGreaterThan(0);
    });

    it('denies REST asset writes to a seat subject whatever the role holds', async () => {
      for (const user of [tech, widened]) {
        for (const action of ['update', 'delete', 'create']) {
          const allowed = await authorizeApiResource({
            knex: db, tenant, user, resource: 'asset', action,
            recordContext: { id: ownAsset, clientId: ownClient },
          });
          expect(allowed, `${action} (${user === tech ? 'seat role' : 'widened'})`).toBe(false);
        }
        // Another client's asset is not even readable: the REST routes answer it as not found.
        expect(await authorizeApiResource({ knex: db, tenant, user, resource: 'asset', action: 'read', recordContext: { id: otherAsset, clientId: otherClient } })).toBe(false);
        expect(await authorizeApiResource({ knex: db, tenant, user, resource: 'asset', action: 'read', recordContext: { id: ownAsset, clientId: ownClient } })).toBe(true);
      }
      expect(await authorizeApiResource({ knex: db, tenant, user: msp, resource: 'asset', action: 'update', recordContext: { id: ownAsset, clientId: ownClient } })).toBe(true);
    });
  });

  // The flagged slice must leave the MSP asset experience as it was.
  it('regression: an MSP user still gets purchase cost and the billing profile', async () => {
    as(msp);
    const bundle = asRecord(await getAssetDetailBundle(ownAsset));
    expect(bundle.asset).toMatchObject({ purchase_cost: COST, purchase_cost_currency: 'EUR', billing_profile_name: BILLING_PROFILE_NAME });
    expect(bundle.asset.billing_profile_id).toBeTruthy();
    const plain = asRecord(await getAsset(ownAsset));
    expect(plain).toMatchObject({ purchase_cost: COST, billing_profile_name: BILLING_PROFILE_NAME });
    const list = asRecord(await listAssets({}));
    const row = list.assets.find((a: any) => a.asset_id === ownAsset);
    expect(row).toMatchObject({ purchase_cost: expect.anything() });
    expect(list.assets.map((a: any) => a.asset_id)).toEqual(expect.arrayContaining([ownAsset, otherAsset]));
    const history = (await getAssetHistory(ownAsset)) as any[];
    expect(history[0].changes).toHaveProperty('purchase_cost');
    expect(await attempt(() => linkAssetToTicket({ asset_id: ownAsset, ticket_id: hiddenBoardTicket }))).toBeNull();
  });
});
