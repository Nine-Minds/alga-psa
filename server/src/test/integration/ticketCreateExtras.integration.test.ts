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
import * as ticketResourceActions from '@alga-psa/tickets/actions/ticketResourceActions';
import { TestContext } from '../../../test-utils/testContext';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createUser } from '../../../test-utils/testDataFactory';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import * as dbModule from '@alga-psa/db';
import { tenantDb } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

const HOOK_TIMEOUT = 900_000;

describe.sequential('addTicket create extras (integration)', () => {
  const context = new TestContext({ runSeeds: true });
  let realPermissionCheck: typeof rbac.hasPermission;

  let tenantId: string;
  let clientId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let creator: any;
  let watcherUserId: string;
  let primaryAgentId: string;
  let additionalAgentId: string;
  let secondAdditionalAgentId: string;
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

  function poolLikeForActionTransactions() {
    const outer = context.db;
    return new Proxy(outer as any, {
      get: (target, prop) =>
        prop === 'commit' || prop === 'rollback' ? undefined : prop === 'transaction'
          ? (cb: any) => target.transaction(cb)
          : Reflect.get(target, prop, target),
    });
  }

  beforeEach(async () => {
    await context.reset();
    vi.mocked(publishWorkflowEvent).mockClear();
    tenantId = context.tenantId;
    clientId = context.clientId;

    const creatorId = await createUser(context.db, tenantId, {
      username: 'extras-creator', first_name: 'Dana', last_name: 'Creator', email: 'dana@example.com', user_type: 'internal',
    });
    watcherUserId = await createUser(context.db, tenantId, {
      username: 'extras-watcher', first_name: 'Wes', last_name: 'Watcher', email: 'wes@example.com', user_type: 'internal',
    });
    primaryAgentId = await createUser(context.db, tenantId, {
      username: 'extras-primary', first_name: 'Pat', last_name: 'Primary', email: 'pat@example.com', user_type: 'internal',
    });
    additionalAgentId = await createUser(context.db, tenantId, {
      username: 'extras-additional', first_name: 'Ari', last_name: 'Additional', email: 'ari@example.com', user_type: 'internal',
    });
    secondAdditionalAgentId = await createUser(context.db, tenantId, {
      username: 'extras-additional-2', first_name: 'Sam', last_name: 'Second', email: 'sam@example.com', user_type: 'internal',
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
    await tt('clients').insert({ tenant: tenantId, client_id: otherClientId, client_name: `Other Client ${uuidv4()}` });
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
    const poolLike = poolLikeForActionTransactions();
    vi.spyOn(dbModule, 'createTenantKnex').mockImplementationOnce(async () => ({ knex: poolLike, tenant: tenantId }) as any);
    const outcome = await ticketActions.addTicket(
      createForm({ asset_ids: JSON.stringify([assetA, foreignAsset]) })
    ).then((value: any) => ({ value }), (error: Error) => ({ error }));
    const message = 'error' in outcome ? outcome.error.message : JSON.stringify(outcome.value);
    expect(message).toMatch(/Invalid asset/);
    expect(await countTickets()).toBe(before);
    expect(await tt('asset_associations').where({ asset_id: assetA }).count('* as n').first().then((r: any) => Number(r.n))).toBe(0);
  });

  it('creates primary and additional staffing atomically when later ticket updates are denied', async () => {
    const before = await countTickets();
    const ticketUpdatePermissions = await tt('permissions')
      .where({ resource: 'ticket', action: 'update', msp: true }).select('permission_id');
    await tt('role_permissions').whereIn('permission_id', ticketUpdatePermissions.map((p: any) => p.permission_id)).delete();
    vi.spyOn(dbModule, 'createTenantKnex').mockImplementationOnce(async () => ({
      knex: poolLikeForActionTransactions(), tenant: tenantId,
    }) as any);
    const created: any = await ticketActions.addTicket(createForm({
      assigned_to: primaryAgentId,
      additional_agent_ids: JSON.stringify([additionalAgentId]),
    }));
    expect(created?.ticket_id).toBeTruthy();

    // The creator has create but not update permission for both creation and the
    // follow-up resource action. The assignment inserted during creation stays available.
    const beforeDeniedAssignments = await tt('ticket_resources').where({ ticket_id: created.ticket_id }).select('*');
    const beforeDeniedAudit = await tt('ticket_audit_logs').where({ ticket_id: created.ticket_id }).select('*');
    const denied = await ticketResourceActions.addTicketResource(created.ticket_id, secondAdditionalAgentId, 'support');

    expect(denied).toMatchObject({ permissionError: expect.stringContaining('Permission denied') });
    const ticket = await tt('tickets').where({ ticket_id: created.ticket_id }).first();
    expect(ticket.assigned_to).toBe(primaryAgentId);
    expect(await tt('ticket_resources').where({ ticket_id: created.ticket_id }).select('*'))
      .toEqual(beforeDeniedAssignments);
    expect(beforeDeniedAssignments.map((row: any) => row.additional_user_id)).toEqual([additionalAgentId]);
    expect(await tt('ticket_audit_logs').where({ ticket_id: created.ticket_id }).select('*')).toEqual(beforeDeniedAudit);
    expect(beforeDeniedAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'TICKET_ASSIGNED', details: expect.objectContaining({ additional_agent_id: additionalAgentId }) }),
    ]));
    expect(await countTickets()).toBe(before + 1);
  });

  it('keeps create-time staffing when creator has ticket:update but the real record policy denies later updates', async () => {
    const bundle = await createAuthorizationBundle(context.db, {
      tenant: tenantId,
      name: `assigned-only-ticket-updates-${uuidv4()}`,
      actorUserId: creator.user_id,
    });
    await upsertBundleRule(context.db, {
      tenant: tenantId,
      bundleId: bundle.bundleId,
      revisionId: bundle.revisionId,
      resourceType: 'ticket',
      action: 'update',
      templateKey: 'assigned',
      config: {},
      actorUserId: creator.user_id,
    });
    await publishBundleRevision(context.db as any, {
      tenant: tenantId,
      bundleId: bundle.bundleId,
      revisionId: bundle.revisionId,
      actorUserId: creator.user_id,
    });
    await createBundleAssignment(context.db, {
      tenant: tenantId,
      bundleId: bundle.bundleId,
      targetType: 'user',
      targetId: creator.user_id,
      actorUserId: creator.user_id,
    });

    expect(await auth.hasPermission(creator, 'ticket', 'update', context.db)).toBe(true);
    vi.spyOn(dbModule, 'createTenantKnex').mockImplementationOnce(async () => ({
      knex: poolLikeForActionTransactions(), tenant: tenantId,
    }) as any);
    const created: any = await ticketActions.addTicket(createForm({
      assigned_to: primaryAgentId,
      additional_agent_ids: JSON.stringify([additionalAgentId]),
    }));
    expect(created?.ticket_id).toBeTruthy();
    expect(await tt('tickets').where({ ticket_id: created.ticket_id }).first())
      .toMatchObject({ assigned_to: primaryAgentId });
    expect(await tt('ticket_resources').where({ ticket_id: created.ticket_id }).select('*'))
      .toEqual([expect.objectContaining({ additional_user_id: additionalAgentId })]);

    const beforeDeniedAssignments = await tt('ticket_resources').where({ ticket_id: created.ticket_id }).select('*');
    const beforeDeniedAudit = await tt('ticket_audit_logs').where({ ticket_id: created.ticket_id }).select('*');
    const denied = await ticketResourceActions.addTicketResource(created.ticket_id, secondAdditionalAgentId, 'support');
    expect(denied).toMatchObject({ permissionError: expect.stringMatching(/Cannot access ticket|record/i) });
    expect((await tt('tickets').where({ ticket_id: created.ticket_id }).first()).assigned_to).toBe(primaryAgentId);
    expect(await tt('ticket_resources').where({ ticket_id: created.ticket_id }).select('*'))
      .toEqual(beforeDeniedAssignments);
    expect(await tt('ticket_audit_logs').where({ ticket_id: created.ticket_id }).select('*'))
      .toEqual(beforeDeniedAudit);
  });

  it('rolls back ticket and valid staffing when a later additional agent is invalid', async () => {
    const before = await countTickets();
    const eventsBefore = vi.mocked(publishWorkflowEvent).mock.calls.length;
    vi.spyOn(dbModule, 'createTenantKnex').mockImplementationOnce(async () => ({
      knex: poolLikeForActionTransactions(), tenant: tenantId,
    }) as any);
    const outcome = await ticketActions.addTicket(createForm({
      assigned_to: primaryAgentId,
      additional_agent_ids: JSON.stringify([additionalAgentId, uuidv4()]),
    }));

    expect(outcome).toMatchObject({
      actionError: expect.stringMatching(/selected agents cannot be assigned/i),
    });
    expect(await countTickets()).toBe(before);
    expect(await tt('ticket_resources').where({ additional_user_id: additionalAgentId }).count('* as n').first()
      .then((row: any) => Number(row.n))).toBe(0);
    expect(await tt('ticket_audit_logs').where({ event_type: 'TICKET_ASSIGNED' })
      .whereRaw("details->>'additional_agent_id' = ?", [additionalAgentId]).count('* as n').first()
      .then((row: any) => Number(row.n))).toBe(0);
    expect(vi.mocked(publishWorkflowEvent).mock.calls).toHaveLength(eventsBefore);
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

  it('publishes ticket creation and staffing only after commit, when independent reads see committed assignments', async () => {
    const setupTransaction = context.transaction;
    expect(setupTransaction).toBeTruthy();
    await setupTransaction!.commit();
    (context as any).activeTransaction = null;

    // Use a distinct pool so a read cannot see rows through the writer transaction.
    const observerDb = await createTestDbConnection({ recreate: false });
    const observed: Array<{ eventType: string; ticket: any; resources: any[] }> = [];
    vi.mocked(publishWorkflowEvent).mockImplementation(async (event: any) => {
      const ticketId = event.payload?.ticketId;
      if (!ticketId || !['TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_ADDITIONAL_AGENT_ASSIGNED'].includes(event.eventType)) return;
      const ticket = await observerDb('tickets').where({ tenant: tenantId, ticket_id: ticketId }).first();
      const resources = await observerDb('ticket_resources').where({ tenant: tenantId, ticket_id: ticketId }).select('*');
      observed.push({ eventType: event.eventType, ticket, resources });
    });

    try {
      const created: any = await ticketActions.addTicket(createForm({
        assigned_to: primaryAgentId,
        additional_agent_ids: JSON.stringify([additionalAgentId]),
      }));
      expect(created?.ticket_id).toBeTruthy();

      for (const eventType of ['TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_ADDITIONAL_AGENT_ASSIGNED']) {
        const observation = observed.find((entry) => entry.eventType === eventType);
        expect(observation, `${eventType} should be published after the create commit`).toBeTruthy();
        expect(observation!.ticket).toMatchObject({ ticket_id: created.ticket_id, assigned_to: primaryAgentId });
        expect(observation!.resources).toEqual(expect.arrayContaining([
          expect.objectContaining({ ticket_id: created.ticket_id, additional_user_id: additionalAgentId }),
        ]));
      }
    } finally {
      await observerDb.destroy();
    }
  });
});
