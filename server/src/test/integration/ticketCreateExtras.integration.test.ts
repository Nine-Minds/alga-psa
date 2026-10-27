/**
 * Integration test for the optional create extras on addTicket: linked assets, and watchers
 * are written in the ticket's own transaction, and an invalid one rolls the whole
 * create back. Real database and RBAC; only the session seam is mocked (as in
 * ticketDuplicate.integration.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupCommonMocks, createMockUser } from '../../../test-utils/testMocks';
import * as auth from '@alga-psa/auth';
import * as rbac from '@alga-psa/auth/rbac';
import * as ticketActions from '@alga-psa/tickets/actions/ticketActions';
import { TestContext } from '../../../test-utils/testContext';
import { createUser } from '../../../test-utils/testDataFactory';
import * as dbModule from '@alga-psa/db';
import { tenantDb } from '@alga-psa/db';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

const HOOK_TIMEOUT = 900_000;

describe('addTicket create extras (integration)', () => {
  const context = new TestContext({ runSeeds: true });
  let realPermissionCheck: typeof rbac.hasPermission;

  let tenantId: string;
  let clientId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let creator: any;
  let watcherUserId: string;
  let assetA: string;
  let assetB: string;
  let foreignAsset: string;

  const tt = (table: string) => tenantDb(context.db, tenantId).table(table);

  beforeAll(async () => {
    await context.initialize();
    realPermissionCheck = (await vi.importActual<typeof rbac>('@alga-psa/auth/rbac')).hasPermission;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await context.cleanup();
  }, HOOK_TIMEOUT);

  function createForm(overrides: Record<string, string> = {}): FormData {
    const form = new FormData();
    const fields: Record<string, string> = {
      title: 'Full form ticket',
      description: 'created with extras',
      board_id: boardId,
      client_id: clientId,
      status_id: statusId,
      priority_id: priorityId,
      assigned_to: '',
      ...overrides,
    };
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return form;
  }

  async function insertAsset(forClientId: string, tag: string) {
    const assetId = uuidv4();
    await tt('assets').insert({
      tenant: tenantId,
      asset_id: assetId,
      client_id: forClientId,
      asset_type: 'workstation',
      asset_tag: tag,
      name: `Asset ${tag}`,
      status: 'active',
    });
    return assetId;
  }

  async function countTickets(): Promise<number> {
    const row = await tt('tickets').count('* as n').first();
    return Number((row as any).n);
  }

  beforeEach(async () => {
    await context.reset();
    tenantId = context.tenantId;
    clientId = context.clientId;

    const creatorId = await createUser(context.db, tenantId, {
      username: 'extras-creator', first_name: 'Dana', last_name: 'Creator', email: 'dana@example.com', user_type: 'internal',
    });
    watcherUserId = await createUser(context.db, tenantId, {
      username: 'extras-watcher', first_name: 'Wes', last_name: 'Watcher', email: 'wes@example.com', user_type: 'internal',
    });

    boardId = uuidv4();
    await tt('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'Extras Board' });
    priorityId = (await tt('priorities').where({ item_type: 'ticket' }).first()).priority_id;
    statusId = uuidv4();
    await tt('statuses').insert({
      tenant: tenantId, status_id: statusId, name: 'Extras Open', board_id: boardId, status_type: 'ticket',
      is_closed: false, is_default: true, order_number: 9001, created_by: creatorId,
    });

    const otherClientId = uuidv4();
    await tt('clients').insert({ tenant: tenantId, client_id: otherClientId, client_name: 'Other Client' });
    assetA = await insertAsset(clientId, 'EXT-A');
    assetB = await insertAsset(clientId, 'EXT-B');
    foreignAsset = await insertAsset(otherClientId, 'EXT-X');

    setupCommonMocks({ tenantId, user: createMockUser('internal') });
    vi.mocked(rbac.hasPermission).mockImplementation(realPermissionCheck);
    vi.mocked(auth.hasPermission).mockImplementation(realPermissionCheck);

    // Ticket create/read plus asset update (linking assets is an asset-update operation).
    const roleId = uuidv4();
    await tt('roles').insert({ tenant: tenantId, role_id: roleId, role_name: `Extras ${roleId}`, msp: true, client: false });
    const permissions = await tt('permissions')
      .where({ msp: true })
      .where((qb: any) =>
        qb.where({ resource: 'ticket' }).whereIn('action', ['read', 'create', 'update'])
          .orWhere({ resource: 'asset' }).whereIn('action', ['read', 'update'])
      )
      .select('permission_id');
    await tt('role_permissions').insert(
      permissions.map((p: any) => ({ tenant: tenantId, role_id: roleId, permission_id: p.permission_id }))
    );
    await tt('user_roles').insert({ tenant: tenantId, role_id: roleId, user_id: creatorId });

    const query = tt('users').select('users.*').where('users.user_id', creatorId);
    tenantDb(context.db, tenantId).tenantJoin(query, 'user_roles', 'users.user_id', 'user_roles.user_id', { type: 'left' });
    tenantDb(context.db, tenantId).tenantJoin(query, 'roles', 'user_roles.role_id', 'roles.role_id', { type: 'left' });
    creator = await query.first();
    vi.mocked(auth.getCurrentUser).mockResolvedValue(creator);
  }, HOOK_TIMEOUT);

  it('writes assets and watchers together with the ticket', async () => {
    const result: any = await ticketActions.addTicket(
      createForm({
        asset_id: assetA, // the "opened from asset" id merges with the list and dedupes
        asset_ids: JSON.stringify([assetA, assetB]),
        watcher_ids: JSON.stringify([watcherUserId]),
        custom_fields: JSON.stringify({ Serial: 'SN-1', Rack: 'R7' }), // ignored: not persisted
      })
    );
    expect(result?.ticket_id).toBeTruthy();

    const links = await tt('asset_associations').where({ entity_id: result.ticket_id, entity_type: 'ticket' });
    expect(links.map((l: any) => l.asset_id).sort()).toEqual([assetA, assetB].sort());

    const row = await tt('tickets').where({ ticket_id: result.ticket_id }).first();
    const attributes = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes;
    expect(attributes?.custom_fields).toBeUndefined();
    expect(attributes.watch_list).toEqual([
      expect.objectContaining({ email: 'wes@example.com', active: true, entity_type: 'user', entity_id: watcherUserId }),
    ]);
  });

  it('keeps working with every new field omitted (single asset_id)', async () => {
    const result: any = await ticketActions.addTicket(createForm({ asset_id: assetA }));
    expect(result?.ticket_id).toBeTruthy();
    const links = await tt('asset_associations').where({ entity_id: result.ticket_id });
    expect(links.map((l: any) => l.asset_id)).toEqual([assetA]);
  });

  it('rolls the whole create back when an asset belongs to another client', async () => {
    const before = await countTickets();
    // TestContext runs everything inside one outer transaction, so addTicket's withTransaction would
    // just join it and nothing could roll back. Hand the action a pool-like handle (no commit/rollback)
    // whose transaction() is a savepoint, so the action owns its transaction as it does in production.
    const outer = context.db;
    const poolLike = new Proxy(outer as any, {
      get: (target, prop) =>
        prop === 'commit' || prop === 'rollback' ? undefined : prop === 'transaction'
          ? (cb: any) => target.transaction(cb)
          : Reflect.get(target, prop, target),
    });
    vi.spyOn(dbModule, 'createTenantKnex').mockImplementationOnce(async () => ({ knex: poolLike, tenant: tenantId }) as any);
    const outcome = await ticketActions.addTicket(
      createForm({ asset_ids: JSON.stringify([assetA, foreignAsset]) })
    ).then((value: any) => ({ value }), (error: Error) => ({ error }));
    const message = 'error' in outcome ? outcome.error.message : JSON.stringify(outcome.value);
    expect(message).toMatch(/Invalid asset/);
    expect(await countTickets()).toBe(before);
    expect(await tt('asset_associations').where({ asset_id: assetA }).count('* as n').first().then((r: any) => Number(r.n))).toBe(0);
  });

  it('rejects an unknown watcher without creating a ticket', async () => {
    const before = await countTickets();
    const badWatcher = await ticketActions.addTicket(createForm({ watcher_ids: JSON.stringify([uuidv4()]) }))
      .then((v: any) => JSON.stringify(v), (e: Error) => e.message);
    expect(badWatcher).toMatch(/Invalid watcher/);
    expect(await countTickets()).toBe(before);
  });

  it('ignores custom_fields sent in the FormData: no error, nothing persisted', async () => {
    const result: any = await ticketActions.addTicket(
      createForm({ custom_fields: JSON.stringify({ Serial: 'SN-1' }) })
    );
    expect(result?.ticket_id).toBeTruthy();
    const row = await tt('tickets').where({ ticket_id: result.ticket_id }).first();
    const attributes = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes;
    expect(attributes?.custom_fields).toBeUndefined();
    // Malformed values are ignored too, not rejected.
    const malformed: any = await ticketActions.addTicket(createForm({ custom_fields: '{not json' }));
    expect(malformed?.ticket_id).toBeTruthy();
  });

  it('rejects linking assets without asset:update permission', async () => {
    const before = await countTickets();
    const denied = await tt('permissions').where({ resource: 'asset', action: 'update', msp: true }).select('permission_id');
    await tt('role_permissions').whereIn('permission_id', denied.map((p: any) => p.permission_id)).delete();
    const message = await ticketActions.addTicket(createForm({ asset_ids: JSON.stringify([assetA]) }))
      .then((v: any) => JSON.stringify(v), (e: Error) => e.message);
    expect(message).toMatch(/Cannot link assets/);
    expect(await countTickets()).toBe(before);
  });
});
