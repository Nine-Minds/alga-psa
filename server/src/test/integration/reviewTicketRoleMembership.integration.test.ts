import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { TestContext } from '../../../test-utils/testContext';
import { createClient, createUser } from '../../../test-utils/testDataFactory';
import { setupCommonMocks } from '../../../test-utils/testMocks';
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
import { NextRequest } from 'next/server';
import { ApiTicketController } from '../../lib/api/controllers/ApiTicketController';

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

async function assignSelectedClientBundle(userId: string, targetType: 'user' | 'role' = 'user') {
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
    targetType,
    targetId: userId,
    actorUserId: actor.user_id,
  });
}

async function assignSameTeamBundle(userId: string, action: 'read' | 'update') {
  await table('authorization_bundle_assignments')
    .where({ target_type: 'user', target_id: userId })
    .delete();
  const bundle = await createAuthorizationBundle(context.db, {
    tenant,
    name: `Ticket ${action} same team ${uuidv4()}`,
    actorUserId: actor.user_id,
  });
  await upsertBundleRule(context.db, {
    tenant,
    bundleId: bundle.bundleId,
    revisionId: bundle.revisionId,
    resourceType: 'ticket',
    action,
    templateKey: 'same_team',
    config: {},
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

async function createAssignedTeamTicket(teamId: string, title: string) {
  const ticketId = await insertTicket(clientOutside, title);
  await table('tickets').where({ ticket_id: ticketId }).update({ assigned_team_id: teamId });
  return ticketId;
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


  it('review: current role bundle is enforced even when supplied user roles predate membership change', async () => {
    await table('authorization_bundle_assignments').where({ target_type: 'user', target_id: actor.user_id }).delete();
    const oldRoles = await table('roles').whereIn('role_id', table('user_roles').where({ user_id: actor.user_id }).select('role_id')).select('*');
    actor = { ...actor, roles: oldRoles };
    actAs(actor);
    const newRoleId = uuidv4();
    await table('roles').insert({ tenant, role_id: newRoleId, role_name: `New narrowed role ${newRoleId}`, msp: true, client: false });
    await table('user_roles').insert({ tenant, role_id: newRoleId, user_id: actor.user_id });
    await assignSelectedClientBundle(newRoleId, 'role');
    const ticketId = await insertTicket(clientOutside, 'Role narrowed original');
    const beforeTicket = await table('tickets').where({ ticket_id: ticketId }).first();
    const beforeAuditCount = Number((await table('ticket_audit_logs').count('* as count').first() as any).count);
    const beforeNotificationCount = Number((await table('internal_notifications').count('* as count').first() as any).count);
    const { updateTicketInTransaction } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    const freshRoles = await table('roles').whereIn('role_id', table('user_roles').where({ user_id: actor.user_id }).select('role_id')).select('*');
    await expect(withTransaction(context.db, trx => updateTicketInTransaction(trx, { ...actor, roles: freshRoles }, tenant, ticketId, { title: 'Fresh principal denied' })))
      .rejects.toThrow('Permission denied: Cannot access ticket');
    await expect(withTransaction(context.db, trx => updateTicketInTransaction(trx, actor, tenant, ticketId, {
      title: 'Must be denied',
      attributes: { description: 'Must also be denied', watch_list: [] },
    })))
      .rejects.toThrow('Permission denied: Cannot access ticket');
    expect(await table('tickets').where({ ticket_id: ticketId }).first()).toMatchObject({
      title: beforeTicket.title,
      attributes: beforeTicket.attributes,
    });
    expect(Number((await table('ticket_audit_logs').count('* as count').first() as any).count)).toBe(beforeAuditCount);
    expect(Number((await table('internal_notifications').count('* as count').first() as any).count)).toBe(beforeNotificationCount);
    expect(workflowEvents).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('same_team update permits a current member even when the loaded principal has no team snapshot', async () => {
    await assignSameTeamBundle(actor.user_id, 'update');
    const teamId = uuidv4();
    await table('teams').insert({ tenant, team_id: teamId, team_name: 'Current team member', manager_id: actor.user_id });
    await table('team_members').insert({ tenant, team_id: teamId, user_id: actor.user_id, role: 'member' });
    const ticketId = await createAssignedTeamTicket(teamId, 'Current team original');

    // The actor was loaded before team membership was added; the database is authoritative.
    actor = { ...actor, teams: [] };
    actAs(actor);
    const { updateTicketInTransaction } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    await expect(withTransaction(context.db, trx => updateTicketInTransaction(
      trx, actor, tenant, ticketId, { title: 'Current team authorized' },
    ))).resolves.toBe('success');
    expect((await table('tickets').where({ ticket_id: ticketId }).first()).title).toBe('Current team authorized');
  }, HOOK_TIMEOUT);

  it('same_team update denies a nonmember despite a stale principal team snapshot', async () => {
    await assignSameTeamBundle(actor.user_id, 'update');
    const teamId = uuidv4();
    await table('teams').insert({ tenant, team_id: teamId, team_name: 'Not a member', manager_id: null });
    const ticketId = await createAssignedTeamTicket(teamId, 'Nonmember original');
    actor = { ...actor, teams: [{ team_id: teamId }] };
    actAs(actor);

    const { updateTicketInTransaction } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    await expect(withTransaction(context.db, trx => updateTicketInTransaction(
      trx, actor, tenant, ticketId, { title: 'Must remain denied' },
    ))).rejects.toThrow('Permission denied: Cannot access ticket');
    expect((await table('tickets').where({ ticket_id: ticketId }).first()).title).toBe('Nonmember original');
  }, HOOK_TIMEOUT);

  it('same_team update denies a removed member despite the principal retaining the old team', async () => {
    await assignSameTeamBundle(actor.user_id, 'update');
    const teamId = uuidv4();
    await table('teams').insert({ tenant, team_id: teamId, team_name: 'Removed member', manager_id: actor.user_id });
    await table('team_members').insert({ tenant, team_id: teamId, user_id: actor.user_id, role: 'member' });
    const ticketId = await createAssignedTeamTicket(teamId, 'Removed member original');
    actor = { ...actor, teams: [{ team_id: teamId }] };
    await table('team_members').where({ user_id: actor.user_id, team_id: teamId }).delete();
    actAs(actor);

    const { updateTicketInTransaction } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    await expect(withTransaction(context.db, trx => updateTicketInTransaction(
      trx, actor, tenant, ticketId, { title: 'Must remain denied' },
    ))).rejects.toThrow('Permission denied: Cannot access ticket');
    expect((await table('tickets').where({ ticket_id: ticketId }).first()).title).toBe('Removed member original');
  }, HOOK_TIMEOUT);

  it('same_team ticket reads use current team membership for subresource authorization', async () => {
    await assignSameTeamBundle(actor.user_id, 'read');
    const teamId = uuidv4();
    await table('teams').insert({ tenant, team_id: teamId, team_name: 'Read scoped team', manager_id: actor.user_id });
    await table('team_members').insert({ tenant, team_id: teamId, user_id: actor.user_id, role: 'member' });
    const ticketId = await createAssignedTeamTicket(teamId, 'Read scope original');
    const { authorizeTicketRecordAccess } = await import('@alga-psa/tickets/lib/ticketRecordAuthorization');

    await expect(withTransaction(context.db, trx => authorizeTicketRecordAccess({
      trx, tenant, user: { ...actor, teams: [] }, ticketId, action: 'read',
    }))).resolves.toMatchObject({ ticket_id: ticketId });

    await table('team_members').where({ user_id: actor.user_id, team_id: teamId }).delete();
    await expect(withTransaction(context.db, trx => authorizeTicketRecordAccess({
      trx, tenant, user: { ...actor, teams: [{ team_id: teamId }] }, ticketId, action: 'read',
    }))).rejects.toThrow('Permission denied: Cannot access ticket');
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

  it('enforces the same selected-client bundle on REST TicketService.update and permits an in-scope REST update', async () => {
    const outsideId = await insertTicket(clientOutside, 'REST outside original');
    const insideId = await insertTicket(clientInScope, 'REST inside original');
    const service = new TicketService();
    const apiKeyId = uuidv4();
    const serviceContext = { tenant, userId: actor.user_id, user: actor, apiKeyId, db: context.db };
    const notificationCount = Number((await table('internal_notifications').count('* as count').first() as any).count);

    const missingPrincipal = await runWithTenant(tenant, () => service.update(
      insideId,
      { title: 'REST missing principal' } as any,
      { tenant, userId: actor.user_id, apiKeyId, db: context.db } as any,
    )).then(() => null, (error) => error);
    expect(missingPrincipal).toBeInstanceOf(ForbiddenError);
    expect((await table('tickets').where({ ticket_id: insideId }).first()).title).toBe('REST inside original');

    const restDenial = await runWithTenant(tenant, () => service.update(outsideId, { title: 'REST unauthorized' } as any, serviceContext as any))
      .then(() => null, (error) => error);
    expect(restDenial).toBeInstanceOf(ForbiddenError);
    expect((await table('tickets').where({ ticket_id: outsideId }).first()).title).toBe('REST outside original');
    expect(authorizationObservations).toContainEqual({ ticketId: outsideId, title: 'REST outside original', apiKeyId });
    expect(Number((await table('internal_notifications').count('* as count').first() as any).count)).toBe(notificationCount);
    expect(workflowEvents).toHaveLength(0);

    await expect(runWithTenant(tenant, () => service.update(insideId, { title: 'REST authorized' } as any, serviceContext as any)))
      .resolves.toMatchObject({ title: 'REST authorized' });

    // Exercise the actual REST controller boundary. ApiTicketController.update
    // forwards the authenticated middleware context (including apiKeyId) to
    // TicketService.update; only authentication is replaced to avoid external
    // key storage while keeping permission, service, and database behavior live.
    const controller = new ApiTicketController();
    const request = new NextRequest(`http://localhost/api/v1/tickets/${insideId}`, {
      method: 'PUT',
      body: JSON.stringify({ title: 'REST controller authorized' }),
      headers: { 'content-type': 'application/json' },
    }) as any;
    request.params = { id: insideId };
    const authenticatedContext = {
      userId: actor.user_id,
      tenant,
      user: actor,
      apiKeyId,
      db: context.db,
    };
    request.context = authenticatedContext;
    (controller as any).authenticate = vi.fn(async () => request);
    // The update route also performs a separate preflight read. Keep this test
    // focused on update principal propagation; record-level update enforcement
    // remains live in TicketService.update below.
    (controller as any).assertTicketReadAllowed = vi.fn(async () => ({}));
    const response = await controller.update()(request);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ title: 'REST controller authorized' });
    expect(authorizationObservations).toContainEqual({ ticketId: insideId, title: 'REST authorized', apiKeyId });
    expect(authorizationObservations).toContainEqual({ ticketId: insideId, title: 'REST authorized', apiKeyId });
  }, HOOK_TIMEOUT);
});
