import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { TestContext } from '../../../test-utils/testContext';
import { createClient, createUser } from '../../../test-utils/testDataFactory';
import { createMockUser, setupCommonMocks } from '../../../test-utils/testMocks';
import * as auth from '@alga-psa/auth';
import * as rbac from '@alga-psa/auth/rbac';
import { runWithTenant, tenantDb, withTransaction } from '@alga-psa/db';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import * as recordAuthorization from '@alga-psa/tickets/lib/ticketRecordAuthorization';
import { TicketService } from '../../lib/api/services/TicketService';
import { ForbiddenError } from '../../lib/api/middleware/apiMiddleware';
import { ApiTicketController } from '../../lib/api/controllers/ApiTicketController';
import { NextRequest } from 'next/server';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  return {
    ...createAuthModuleMock(),
    localizeActionError: vi.fn(async (error: unknown) => error),
  };
});

const authorizationObservations = vi.hoisted(() => [] as Array<{ ticketId: string; title: string | undefined; apiKeyId?: string }>);
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/tickets/lib/ticketRecordAuthorization')>();
  return {
    ...actual,
    authorizeTicketRecordAccess: vi.fn(async (input: any) => {
      authorizationObservations.push({
        ticketId: input.ticketId,
        title: input.ticketRow?.title,
        ...(input.apiKeyId ? { apiKeyId: input.apiKeyId } : {}),
      });
      return actual.authorizeTicketRecordAccess(input);
    }),
  };
});

const workflowEvents = vi.hoisted(() => [] as unknown[]);
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/event-bus/publishers')>()),
  publishWorkflowEvent: vi.fn(async (event: unknown) => { workflowEvents.push(event); }),
  publishStoredWorkflowEvent: vi.fn(async (event: unknown) => { workflowEvents.push(event); }),
}));

const context = new TestContext({ runSeeds: true });
const HOOK_TIMEOUT = 900_000;
let tenant: string;
let scoped: ReturnType<typeof tenantDb>;
let clientInScope: string;
let clientOutside: string;
let boardId: string;
let statusId: string;
let nextStatusId: string;
let priorityId: number;
let actor: any;
let realPermissionCheck: typeof rbac.hasPermission;

const table = (name: string) => scoped.table(name);

async function grantTicketUpdate(userId: string) {
  const roleId = uuidv4();
  await table('roles').insert({ tenant, role_id: roleId, role_name: `Ticket update ${roleId}`, msp: true, client: false });
  const permission = await table('permissions').where({ resource: 'ticket', action: 'update', msp: true }).first('permission_id');
  if (!permission) throw new Error('ticket:update permission is missing from the permission catalog');
  await table('role_permissions').insert({ tenant, role_id: roleId, permission_id: permission.permission_id });
  await table('user_roles').insert({ tenant, role_id: roleId, user_id: userId });
}

async function loadUser(userId: string) {
  const query = table('users').select('users.*').where('users.user_id', userId);
  scoped.tenantJoin(query, 'user_roles', 'users.user_id', 'user_roles.user_id', { type: 'left' });
  scoped.tenantJoin(query, 'roles', 'user_roles.role_id', 'roles.role_id', { type: 'left' });
  return query.first();
}

function actAs(user: any) {
  vi.mocked(auth.getCurrentUser).mockResolvedValue(user);
  setupCommonMocks({ tenantId: tenant, user, permissionCheck: () => true });
  vi.mocked(rbac.hasPermission).mockImplementation(realPermissionCheck);
  vi.mocked(auth.hasPermission).mockImplementation(realPermissionCheck);
}

async function insertTicket(clientId: string, title: string) {
  const ticketId = uuidv4();
  await table('tickets').insert({
    tenant,
    ticket_id: ticketId,
    ticket_number: `AUTH-${uuidv4().slice(0, 8)}`,
    title,
    client_id: clientId,
    board_id: boardId,
    status_id: statusId,
    priority_id: priorityId,
    attributes: { description: 'Original description', watch_list: [{ email: 'watcher@example.test', active: true }] },
    entered_by: actor.user_id,
    entered_at: new Date(),
    updated_at: new Date(),
    is_closed: false,
  });
  return ticketId;
}

async function assignSelectedClientBundle(userId: string) {
  const bundle = await createAuthorizationBundle(context.db, {
    tenant,
    name: `Ticket update ${uuidv4()}`,
    actorUserId: actor.user_id,
  });
  await upsertBundleRule(context.db, {
    tenant,
    bundleId: bundle.bundleId,
    revisionId: bundle.revisionId,
    resourceType: 'ticket',
    action: 'update',
    templateKey: 'selected_clients',
    config: { selectedClientIds: [clientInScope] },
    actorUserId: actor.user_id,
  });
  await publishBundleRevision(context.db as any, {
    tenant,
    bundleId: bundle.bundleId,
    revisionId: bundle.revisionId,
    actorUserId: actor.user_id,
  });
  await createBundleAssignment(context.db, {
    tenant,
    bundleId: bundle.bundleId,
    targetType: 'user',
    targetId: userId,
    actorUserId: actor.user_id,
  });
}

describe('ticket update record authorization (real transaction)', () => {
  beforeAll(async () => {
    await context.initialize();
    realPermissionCheck = (await vi.importActual<typeof rbac>('@alga-psa/auth/rbac')).hasPermission;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await context.cleanup();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await context.reset();
    tenant = context.tenantId;
    scoped = tenantDb(context.db, tenant);
    authorizationObservations.length = 0;
    workflowEvents.length = 0;

    clientInScope = context.clientId;
    clientOutside = await createClient(context.db, tenant, `Outside ${uuidv4().slice(0, 6)}`);
    boardId = uuidv4();
    statusId = uuidv4();
    await table('boards').insert({ tenant, board_id: boardId, board_name: 'Record auth' });
    await table('statuses').insert({ tenant, status_id: statusId, name: 'Open', board_id: boardId, status_type: 'ticket', is_closed: false, is_default: true, order_number: 5001 });
    nextStatusId = uuidv4();
    await table('statuses').insert({ tenant, status_id: nextStatusId, name: 'In Progress', board_id: boardId, status_type: 'ticket', is_closed: false, is_default: false, order_number: 5002 });
    const priority = await table('priorities').where({ item_type: 'ticket' }).first('priority_id');
    priorityId = priority.priority_id;

    const userId = await createUser(context.db, tenant, { username: `auth-${uuidv4()}`, first_name: 'Narrowed', user_type: 'internal' });
    actor = await loadUser(userId);
    await grantTicketUpdate(userId);
    actor = await loadUser(userId);
    await assignSelectedClientBundle(userId);
    actAs(actor);
  }, HOOK_TIMEOUT);

  it('denies out-of-bundle UI and legacy writes without changing ticket, mirror, audit, events, or notifications', async () => {
    const ticketId = await insertTicket(clientOutside, 'Outside original');
    await table('ticket_watchers').insert({ tenant, ticket_id: ticketId, email: 'watcher@example.test', active: true });
    const before = await table('tickets').where({ ticket_id: ticketId }).first();
    const watcherRowsBefore = await table('ticket_watchers').where({ ticket_id: ticketId }).select('*');
    const auditCount = Number((await table('ticket_audit_logs').count('* as count').first() as any).count);
    const notificationCount = Number((await table('internal_notifications').count('* as count').first() as any).count);

    const { updateTicketWithCache } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    await expect(updateTicketWithCache(ticketId, {
      title: 'Unauthorized title',
      attributes: { description: 'Unauthorized description', watch_list: [] },
    })).resolves.toMatchObject({ permissionError: 'Permission denied: Cannot access ticket' });

    const afterUi = await table('tickets').where({ ticket_id: ticketId }).first();
    expect(afterUi.title).toBe(before.title);
    expect(afterUi.attributes).toEqual(before.attributes);
    expect(await table('ticket_watchers').where({ ticket_id: ticketId }).select('*')).toEqual(watcherRowsBefore);
    expect(Number((await table('ticket_audit_logs').count('* as count').first() as any).count)).toBe(auditCount);
    expect(Number((await table('internal_notifications').count('* as count').first() as any).count)).toBe(notificationCount);
    expect(workflowEvents).toHaveLength(0);

    const { updateTicket } = await import('@alga-psa/tickets/actions/ticketActions');
    await expect(updateTicket(ticketId, { title: 'Legacy unauthorized title' } as any)).resolves.toMatchObject({
      permissionError: 'Permission denied: Cannot access ticket',
    });
    const afterLegacy = await table('tickets').where({ ticket_id: ticketId }).first();
    expect(afterLegacy.title).toBe(before.title);
    expect(afterLegacy.attributes).toEqual(before.attributes);
    expect(await table('ticket_watchers').where({ ticket_id: ticketId }).select('*')).toEqual(watcherRowsBefore);
    expect(workflowEvents).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('allows an in-bundle update and direct native calls authorize the current row before writes', async () => {
    const ticketId = await insertTicket(clientInScope, 'In-scope original');
    const { updateTicketInTransaction } = await import('@alga-psa/tickets/actions/optimizedTicketActions');

    // Exercise the transaction core directly. A guard added only to updateTicketWithCache
    // cannot satisfy this assertion because no wrapper participates in this call.
    await withTransaction(context.db, async (trx) => {
      const realAuthorize = recordAuthorization.authorizeTicketRecordAccess;
      const writesBeforeAuthorization: string[] = [];
      trx.on('query', (query: { sql: string }) => {
        if (/^\s*(insert|update|delete)\b/i.test(query.sql)) writesBeforeAuthorization.push(query.sql);
      });
      const observed = vi.spyOn(recordAuthorization, 'authorizeTicketRecordAccess').mockImplementationOnce(async (input) => {
        const current = await trx('tickets').where({ ticket_id: ticketId }).first();
        expect(input.ticketRow).toMatchObject({ ticket_id: ticketId, client_id: clientInScope, title: 'In-scope original' });
        expect(current.title).toBe('In-scope original');
        expect(writesBeforeAuthorization).toEqual([]);
        expect(workflowEvents).toHaveLength(0);
        return realAuthorize(input);
      });
      try {
        await updateTicketInTransaction(trx, actor, tenant, ticketId, { title: 'In-scope updated' });
      } finally {
        observed.mockRestore();
      }
    });

    expect(authorizationObservations).toContainEqual({ ticketId, title: 'In-scope original' });
    expect((await table('tickets').where({ ticket_id: ticketId }).first()).title).toBe('In-scope updated');
  }, HOOK_TIMEOUT);

  it('propagates the authenticated principal through a bulk status update', async () => {
    const ticketId = await insertTicket(clientOutside, 'Bulk outside original');
    const { bulkUpdateTicketStatus } = await import('@alga-psa/tickets/actions/ticketActions');

    const result = await bulkUpdateTicketStatus([ticketId], nextStatusId);

    expect(result.updatedIds).toEqual([]);
    expect(result.failed).toEqual([expect.objectContaining({
      ticketId,
      message: 'Permission denied: Cannot access ticket',
    })]);
    expect((await table('tickets').where({ ticket_id: ticketId }).first()).status_id).toBe(statusId);
    expect(workflowEvents).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('applies selected-client narrowing to public saves and quick-add description follow-up updates', async () => {
    const { updateTicketWithCache, updateTicketWithCacheForCurrentUser } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    const { updateTicket } = await import('@alga-psa/tickets/actions/ticketActions');
    const description = '[{"type":"paragraph","content":"Finalized description"}]';
    const saves = [
      { run: (id: string) => updateTicketWithCache(id, { title: 'Scoped UI save' }), changed: { title: 'Scoped UI save' } },
      { run: (id: string) => updateTicketWithCacheForCurrentUser(id, { title: 'Scoped current-user save' }), changed: { title: 'Scoped current-user save' } },
      // QuickAddTicket finalizes uploaded image URLs through this legacy action.
      { run: (id: string) => updateTicket(id, { attributes: { description } }), changed: { attributes: { description } } },
    ];

    for (const { run, changed } of saves) {
      const outsideId = await insertTicket(clientOutside, 'Public save outside');
      const insideId = await insertTicket(clientInScope, 'Public save inside');
      const before = await table('tickets').where({ ticket_id: outsideId }).first();
      const eventCount = workflowEvents.length;
      await expect(run(outsideId)).resolves.toMatchObject({ permissionError: 'Permission denied: Cannot access ticket' });
      expect(await table('tickets').where({ ticket_id: outsideId }).first()).toEqual(before);
      expect(workflowEvents).toHaveLength(eventCount);
      await expect(run(insideId)).resolves.toBe('success');
      const after = await table('tickets').where({ ticket_id: insideId }).first();
      expect(after).toMatchObject(changed);
    }
  }, HOOK_TIMEOUT);

  it('keeps mixed bulk assignment, due date, priority, status, and board moves scoped per ticket', async () => {
    const { bulkAssignTickets, bulkUpdateTicketDueDate, bulkUpdateTicketPriority, bulkUpdateTicketStatus, moveTicketsToBoard } =
      await import('@alga-psa/tickets/actions/ticketActions');
    const destinationBoardId = uuidv4();
    const destinationStatusId = uuidv4();
    await table('boards').insert({ tenant, board_id: destinationBoardId, board_name: 'Bulk destination' });
    await table('statuses').insert({ tenant, status_id: destinationStatusId, name: 'Open', board_id: destinationBoardId, status_type: 'ticket', is_closed: false, is_default: true, order_number: 5001 });

    const updates = [
      { run: (ids: string[]) => bulkAssignTickets(ids, { kind: 'user', userId: actor.user_id }), changed: { assigned_to: actor.user_id } },
      { run: (ids: string[]) => bulkUpdateTicketDueDate(ids, '2026-12-01T00:00:00.000Z'), changed: { due_date: '2026-12-01' } },
      { run: (ids: string[]) => bulkUpdateTicketPriority(ids, String(priorityId)), changed: { priority_id: priorityId } },
      { run: (ids: string[]) => bulkUpdateTicketStatus(ids, nextStatusId), changed: { status_id: nextStatusId } },
      { run: (ids: string[]) => moveTicketsToBoard(ids, destinationBoardId, destinationStatusId), changed: { board_id: destinationBoardId, status_id: destinationStatusId } },
    ];
    for (const { run, changed } of updates) {
      const outsideId = await insertTicket(clientOutside, 'Bulk outside');
      const insideId = await insertTicket(clientInScope, 'Bulk inside');
      const before = await table('tickets').where({ ticket_id: outsideId }).first();
      const result = await run([outsideId, insideId]);
      expect('movedIds' in result ? result.movedIds : result.updatedIds).toEqual([insideId]);
      expect(result.failed).toEqual([{ ticketId: outsideId, message: 'Permission denied: Cannot access ticket' }]);
      expect(await table('tickets').where({ ticket_id: outsideId }).first()).toEqual(before);
      const after = await table('tickets').where({ ticket_id: insideId }).first();
      if ('due_date' in changed) after.due_date = new Date(after.due_date).toISOString().slice(0, 10);
      expect(after).toMatchObject(changed);
    }
  }, HOOK_TIMEOUT);

  it('enforces the same selected-client bundle on REST TicketService.update and permits an in-scope REST update', async () => {
    const outsideId = await insertTicket(clientOutside, 'REST outside original');
    const insideId = await insertTicket(clientInScope, 'REST inside original');
    const service = new TicketService();
    const apiKeyId = uuidv4();
    const serviceContext = { tenant, userId: actor.user_id, user: actor, apiKeyId, db: context.db };
    const notificationCount = Number((await table('internal_notifications').count('* as count').first() as any).count);

    const restDenial = await runWithTenant(tenant, () => service.update(outsideId, { title: 'REST unauthorized' } as any, serviceContext as any))
      .then(() => null, (error) => error);
    expect(restDenial).toBeInstanceOf(ForbiddenError);
    expect((await table('tickets').where({ ticket_id: outsideId }).first()).title).toBe('REST outside original');
    expect(authorizationObservations).toContainEqual({ ticketId: outsideId, title: 'REST outside original', apiKeyId });
    expect(Number((await table('internal_notifications').count('* as count').first() as any).count)).toBe(notificationCount);
    expect(workflowEvents).toHaveLength(0);

    await expect(runWithTenant(tenant, () => service.update(insideId, { title: 'REST authorized' } as any, serviceContext as any)))
      .resolves.toMatchObject({ title: 'REST authorized' });

    // This isolates the controller-to-service handoff with an already-built
    // context. ApiBaseController.authenticate and buildAuthenticatedApiContext
    // are exercised separately in apiMiddleware.clientUserRejection.test.ts.
    const controller = new ApiTicketController();
    const request = new NextRequest(`http://localhost/api/v1/tickets/${insideId}`, {
      method: 'PUT',
      body: JSON.stringify({ title: 'REST controller authorized' }),
      headers: { 'content-type': 'application/json' },
    }) as any;
    request.params = { id: insideId };
    request.context = serviceContext;
    (controller as any).authenticate = vi.fn(async () => request);
    (controller as any).assertTicketReadAllowed = vi.fn(async () => ({}));
    const response = await controller.update()(request);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ title: 'REST controller authorized' });
    expect(authorizationObservations).toContainEqual({
      ticketId: insideId,
      title: 'REST authorized',
      apiKeyId,
    });

    const deniedRequest = new NextRequest(`http://localhost/api/v1/tickets/${outsideId}`, {
      method: 'PUT', body: JSON.stringify({ title: 'REST controller unauthorized' }),
      headers: { 'content-type': 'application/json' },
    }) as any;
    deniedRequest.params = { id: outsideId };
    deniedRequest.context = serviceContext;
    (controller as any).authenticate = vi.fn(async () => deniedRequest);
    expect((await controller.update()(deniedRequest)).status).toBe(403);
    expect((await table('tickets').where({ ticket_id: outsideId }).first()).title).toBe('REST outside original');
  }, HOOK_TIMEOUT);

  it('routes absent REST principals through record authorization and refuses them before any side effects', async () => {
    const ticketId = await insertTicket(clientInScope, 'REST missing principal original');
    await table('ticket_watchers').insert({ tenant, ticket_id: ticketId, email: 'watcher@example.test', active: true });
    const before = await table('tickets').where({ ticket_id: ticketId }).first();
    const watchers = await table('ticket_watchers').where({ ticket_id: ticketId }).select('*');
    const auditCount = await table('ticket_audit_logs').count('* as count').first();
    const notificationCount = await table('internal_notifications').count('* as count').first();
    const service = new TicketService();
    const apiKeyId = uuidv4();

    // A userId/API key alone must not stand in for the authenticated principal.
    for (const user of [undefined, null, {}, { ...actor, user_id: '' }]) {
      const serviceContext = { tenant, userId: actor.user_id, user, apiKeyId, db: context.db };
      vi.mocked(recordAuthorization.authorizeTicketRecordAccess).mockClear();
      const denial = await runWithTenant(tenant, () => service.update(ticketId, {
        title: 'REST unauthorized', attributes: { description: 'Unauthorized description', watch_list: [] },
      } as any, serviceContext)).then(() => null, (error) => error);

      expect(denial).toBeInstanceOf(ForbiddenError);
      expect(denial.message).toBe('Permission denied: Cannot update ticket');
      expect(recordAuthorization.authorizeTicketRecordAccess).toHaveBeenCalledWith(expect.objectContaining({
        user, apiKeyId, ticketId, action: 'update', ticketRow: expect.objectContaining({ title: before.title }),
      }));
      expect(await table('tickets').where({ ticket_id: ticketId }).first()).toEqual(before);
      expect(await table('ticket_watchers').where({ ticket_id: ticketId }).select('*')).toEqual(watchers);
      expect(await table('ticket_audit_logs').count('* as count').first()).toEqual(auditCount);
      expect(await table('internal_notifications').count('* as count').first()).toEqual(notificationCount);
      expect(workflowEvents).toHaveLength(0);

      if (user != null) continue;
      const controller = new ApiTicketController();
      const request = new NextRequest(`http://localhost/api/v1/tickets/${ticketId}`, {
        method: 'PUT', body: JSON.stringify({ title: 'Controller unauthorized' }),
        headers: { 'content-type': 'application/json' },
      }) as any;
      request.params = { id: ticketId };
      request.context = serviceContext;
      // The controller rejects a missing authenticated user before service dispatch.
      (controller as any).authenticate = vi.fn(async () => request);
      (controller as any).assertTicketReadAllowed = vi.fn(async () => ({}));
      const response = await controller.update()(request);
      expect(response.status).toBe(401);
      expect(await table('tickets').where({ ticket_id: ticketId }).first()).toEqual(before);
    }
  }, HOOK_TIMEOUT);

  it('refuses an absent native transaction principal through the shared record guard', async () => {
    const ticketId = await insertTicket(clientInScope, 'Native missing principal original');
    const before = await table('tickets').where({ ticket_id: ticketId }).first();
    const { updateTicketInTransaction } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    for (const user of [undefined, null, {}]) {
      vi.mocked(recordAuthorization.authorizeTicketRecordAccess).mockClear();
      await expect(withTransaction(context.db, (trx) => updateTicketInTransaction(
        trx, user as any, tenant, ticketId, { title: 'Native unauthorized' },
      ))).rejects.toThrow('Permission denied: Cannot access ticket');
      expect(recordAuthorization.authorizeTicketRecordAccess).toHaveBeenCalledWith(expect.objectContaining({ user, ticketId, action: 'update' }));
      expect(await table('tickets').where({ ticket_id: ticketId }).first()).toEqual(before);
      expect(workflowEvents).toHaveLength(0);
    }
  }, HOOK_TIMEOUT);

  it('does not expose the system actor exemption through public MSP save options', async () => {
    const ticketId = await insertTicket(clientOutside, 'Forged system option original');
    const before = await table('tickets').where({ ticket_id: ticketId }).first();
    const auditCount = Number((await table('ticket_audit_logs').count('* as count').first() as any).count);
    const notificationCount = Number((await table('internal_notifications').count('* as count').first() as any).count);
    const { updateTicketWithCache } = await import('@alga-psa/tickets/actions/optimizedTicketActions');

    await expect(updateTicketWithCache(ticketId, { title: 'Forged system option changed' }, { systemActor: true } as any))
      .resolves.toMatchObject({ permissionError: 'Permission denied: Cannot access ticket' });

    const after = await table('tickets').where({ ticket_id: ticketId }).first();
    expect(after.title).toBe(before.title);
    expect(after.attributes).toEqual(before.attributes);
    expect(Number((await table('ticket_audit_logs').count('* as count').first() as any).count)).toBe(auditCount);
    expect(Number((await table('internal_notifications').count('* as count').first() as any).count)).toBe(notificationCount);
    expect(workflowEvents).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('keeps forged system actor options out of bulk updates and denies team changes before mutation', async () => {
    const ticketId = await insertTicket(clientOutside, 'Bulk assignment original');
    const initialTeamId = uuidv4();
    const nextTeamId = uuidv4();
    await table('teams').insert([
      { tenant, team_id: initialTeamId, team_name: 'Initial team', manager_id: actor.user_id },
      { tenant, team_id: nextTeamId, team_name: 'Next team', manager_id: actor.user_id },
    ]);
    await table('tickets').where({ ticket_id: ticketId }).update({ assigned_team_id: initialTeamId });
    const before = await table('tickets').where({ ticket_id: ticketId }).first();
    const auditCount = Number((await table('ticket_audit_logs').count('* as count').first() as any).count);
    const notificationCount = Number((await table('internal_notifications').count('* as count').first() as any).count);
    const forgedSystemActor = { systemActor: true } as any;
    const { bulkAssignTickets, bulkUpdateTicketDueDate, bulkUpdateTicketPriority, bulkUpdateTicketStatus } =
      await import('@alga-psa/tickets/actions/ticketActions');

    const bulkResults = await Promise.all([
      bulkAssignTickets([ticketId], { kind: 'user', userId: actor.user_id }, forgedSystemActor),
      bulkUpdateTicketDueDate([ticketId], '2026-12-01T00:00:00.000Z', forgedSystemActor),
      bulkUpdateTicketPriority([ticketId], String(priorityId), forgedSystemActor),
      bulkUpdateTicketStatus([ticketId], nextStatusId, forgedSystemActor),
    ]);

    for (const result of bulkResults) {
      expect(result.updatedIds).toEqual([]);
      expect(result.failed).toEqual([expect.objectContaining({
        ticketId,
        message: 'Permission denied: Cannot access ticket',
      })]);
    }

    const afterBulk = await table('tickets').where({ ticket_id: ticketId }).first();
    expect(afterBulk).toMatchObject({
      assigned_to: before.assigned_to,
      assigned_team_id: initialTeamId,
      due_date: before.due_date,
      priority_id: before.priority_id,
      status_id: before.status_id,
    });

    const { assignTeamToTicket, removeTeamFromTicket } = await import('@alga-psa/tickets/actions/teamAssignmentActions');
    await expect(assignTeamToTicket(ticketId, nextTeamId)).resolves.toMatchObject({
      permissionError: 'Permission denied: Cannot access ticket',
    });
    await expect(removeTeamFromTicket(ticketId, { mode: 'remove_all' })).resolves.toMatchObject({
      permissionError: 'Permission denied: Cannot access ticket',
    });

    const afterTeamActions = await table('tickets').where({ ticket_id: ticketId }).first();
    expect(afterTeamActions.assigned_team_id).toBe(initialTeamId);
    expect(afterTeamActions.assigned_to).toBe(before.assigned_to);
    expect(Number((await table('ticket_audit_logs').count('* as count').first() as any).count)).toBe(auditCount);
    expect(Number((await table('internal_notifications').count('* as count').first() as any).count)).toBe(notificationCount);
    expect(workflowEvents).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('allows in-scope team assignment and removal through their guarded actions', async () => {
    const ticketId = await insertTicket(clientInScope, 'Scoped team action');
    const teamId = uuidv4();
    await table('teams').insert({ tenant, team_id: teamId, team_name: 'Scoped team', manager_id: actor.user_id });
    const { assignTeamToTicket, removeTeamFromTicket } = await import('@alga-psa/tickets/actions/teamAssignmentActions');

    await expect(assignTeamToTicket(ticketId, teamId)).resolves.toBeUndefined();
    expect((await table('tickets').where({ ticket_id: ticketId }).first()).assigned_team_id).toBe(teamId);

    await expect(removeTeamFromTicket(ticketId, { mode: 'remove_all' })).resolves.toBeUndefined();
    expect((await table('tickets').where({ ticket_id: ticketId }).first()).assigned_team_id).toBeNull();

    await table('tickets').where({ ticket_id: ticketId }).update({ assigned_team_id: teamId });
    const { bulkAssignTickets } = await import('@alga-psa/tickets/actions/ticketActions');
    await expect(bulkAssignTickets([ticketId], { kind: 'user', userId: actor.user_id }))
      .resolves.toMatchObject({ updatedIds: [ticketId], failed: [] });
    expect((await table('tickets').where({ ticket_id: ticketId }).first()).assigned_team_id).toBeNull();
    expect((await table('tickets').where({ ticket_id: ticketId }).first()).assigned_to).toBe(actor.user_id);
  }, HOOK_TIMEOUT);
});
