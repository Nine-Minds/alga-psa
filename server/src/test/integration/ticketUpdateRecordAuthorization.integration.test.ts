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
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  return createAuthModuleMock();
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
  }, HOOK_TIMEOUT);
});
