import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Every real ticket status write site must publish exactly one TICKET_STATUS_CHANGED (previous/new
 * status ids correct) after commit, and nothing when the status did not change. publishWorkflowEvent
 * and publishEvent are mocked and captured; the DB is real.
 */
let testDb: Knex;
let currentUser: any;

type Captured = { eventType: string; payload: Record<string, any>; ctx: Record<string, any> };
const workflowEvents: Captured[] = [];
const busEvents: Array<{ eventType: string; payload: Record<string, any> }> = [];

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/event-bus/publishers')>()),
  publishWorkflowEvent: vi.fn(async (args: Captured) => {
    workflowEvents.push({ eventType: args.eventType, payload: args.payload, ctx: args.ctx });
  }),
  publishEvent: vi.fn(async (event: any) => {
    busEvents.push({ eventType: event.eventType, payload: event.payload });
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db/db')>()),
  getConnection: async () => testDb,
}));
vi.mock('../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db')>()),
  createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant: tenant ?? currentUser?.tenant }),
}));

vi.mock('@alga-psa/auth', async () => {
  const rbac = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
  return {
    ...rbac,
    hasPermission: vi.fn(async () => true),
    getSession: vi.fn(async () => ({ user: currentUser ? { id: currentUser.user_id } : undefined })),
    withAuth: (action: any) => async (...args: any[]) => {
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(currentUser.tenant, () => action(currentUser, { tenant: currentUser.tenant }, ...args));
    },
    withOptionalAuth: (action: any) => async (...args: any[]) => {
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(currentUser.tenant, () => action(currentUser, { tenant: currentUser.tenant }, ...args));
    },
  };
});
vi.mock('@alga-psa/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth/rbac')>()),
  hasPermission: vi.fn(async () => true),
}));

// Workflow actions: permission is a separate concern, keep the real actor/run resolution.
vi.mock('../../../../shared/workflow/runtime/actions/businessOperations/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../shared/workflow/runtime/actions/businessOperations/shared')>()),
  requirePermission: vi.fn(async () => {}),
}));

describe('TICKET_STATUS_CHANGED coverage across status write sites (integration)', () => {
  let tenant: string;
  let scoped: ReturnType<typeof tenantDb>;
  let clientId: string;
  let boardId: string;
  let priorityId: string;
  let actorId: string;
  let runId: string;
  let statusOpen: string;
  let statusProgress: string;
  let statusClosed: string;
  let statusClosedB: string;
  const statusChanged = () => workflowEvents.filter((e) => e.eventType === 'TICKET_STATUS_CHANGED');

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    tenant = await createTenant(testDb, `StatusCoverage ${uuidv4().slice(0, 6)}`);
    scoped = tenantDb(testDb, tenant);
    clientId = await createClient(testDb, tenant, 'Acme');
    actorId = await createUser(testDb, tenant, { email: 'actor@example.com', first_name: 'Ada', last_name: 'Agent' });
    currentUser = {
      user_id: actorId,
      tenant,
      email: 'actor@example.com',
      first_name: 'Ada',
      last_name: 'Agent',
      user_type: 'internal',
      is_inactive: false,
      roles: [],
    };

    boardId = uuidv4();
    priorityId = uuidv4();
    statusOpen = uuidv4();
    statusProgress = uuidv4();
    statusClosed = uuidv4();
    statusClosedB = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Main', is_default: true });
    const mkStatus = (id: string, name: string, order: number, closed: boolean, isDefault = false) => ({
      tenant, status_id: id, board_id: boardId, name, status_type: 'ticket', item_type: 'ticket',
      order_number: order, is_default: isDefault, is_closed: closed,
    });
    await scoped.table('statuses').insert([
      mkStatus(statusOpen, 'New', 1, false, true),
      mkStatus(statusProgress, 'In Progress', 2, false),
      mkStatus(statusClosed, 'Closed', 3, true),
      mkStatus(statusClosedB, 'Resolved', 4, true),
    ]);
    await scoped.table('priorities').insert({
      tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: actorId,
    });

    // Workflow run whose published definition names the actor.
    const workflowId = uuidv4();
    await scoped.table('workflow_definitions').insert({
      workflow_id: workflowId, tenant, name: 'Status coverage', description: null, payload_schema_ref: 'schema://test',
      trigger: {}, draft_definition: { id: workflowId }, draft_version: 1, status: 'draft',
      created_by: actorId, updated_by: actorId, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    runId = uuidv4();
    await scoped.table('workflow_runs').insert({
      run_id: runId, workflow_id: workflowId, workflow_version: 1, tenant, status: 'running',
      started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    const { registerTicketActions } = await import('../../../../shared/workflow/runtime/actions/businessOperations/tickets');
    const { getActionRegistryV2 } = await import('../../../../shared/workflow/runtime/registries/actionRegistry');
    if (!getActionRegistryV2().get('tickets.update_fields', 1)) registerTicketActions();
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy().catch(() => undefined);
  });

  beforeEach(() => {
    workflowEvents.length = 0;
    busEvents.length = 0;
  });

  async function insertTicket(extra: Record<string, unknown> = {}): Promise<string> {
    const ticketId = uuidv4();
    const closed = extra.status_id === statusClosed || extra.status_id === statusClosedB;
    await scoped.table('tickets').insert({
      tenant,
      ticket_id: ticketId,
      ticket_number: `T-${uuidv4().slice(0, 8)}`,
      title: 'Status coverage ticket',
      client_id: clientId,
      board_id: boardId,
      status_id: statusOpen,
      priority_id: priorityId,
      is_closed: closed,
      entered_at: new Date(),
      updated_at: new Date(),
      ...extra,
    });
    return ticketId;
  }

  const statusOf = async (ticketId: string) =>
    (await scoped.table('tickets').where({ ticket_id: ticketId }).first()).status_id as string;

  async function runAction(actionId: string, input: Record<string, unknown>) {
    const { getActionRegistryV2 } = await import('../../../../shared/workflow/runtime/registries/actionRegistry');
    const action = getActionRegistryV2().get(actionId, 1);
    if (!action) throw new Error(`Missing action ${actionId}`);
    return action.handler(action.inputSchema.parse(input), {
      runId,
      stepPath: 'steps.test',
      idempotencyKey: uuidv4(),
      attempt: 1,
      nowIso: () => new Date().toISOString(),
      env: {},
      tenantId: tenant,
      knex: testDb,
    } as any);
  }

  describe('workflow actions', () => {
    it('tickets.update_fields publishes one TICKET_STATUS_CHANGED, stamped with the run as correlation id', async () => {
      const ticketId = await insertTicket();
      await runAction('tickets.update_fields', { ticket_id: ticketId, patch: { status_id: statusProgress } });

      expect(await statusOf(ticketId)).toBe(statusProgress);
      const events = statusChanged();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ ticketId, previousStatusId: statusOpen, newStatusId: statusProgress });
      expect(events[0].ctx).toMatchObject({ tenantId: tenant, correlationId: runId });
      expect(events[0].ctx.actor).toMatchObject({ actorType: 'USER', actorUserId: actorId });
    });

    it('tickets.update_fields publishes no status event when only the title changes', async () => {
      const ticketId = await insertTicket();
      await runAction('tickets.update_fields', { ticket_id: ticketId, patch: { title: 'Renamed' } });
      expect(statusChanged()).toHaveLength(0);
    });

    it('tickets.update_fields publishes no status event when the status is set to its current value', async () => {
      const ticketId = await insertTicket();
      await runAction('tickets.update_fields', { ticket_id: ticketId, patch: { status_id: statusOpen } });
      expect(statusChanged()).toHaveLength(0);
    });

    it('tickets.update_fields publishes nothing when the action fails validation (rolled back)', async () => {
      const ticketId = await insertTicket();
      await expect(
        runAction('tickets.update_fields', { ticket_id: ticketId, patch: { status_id: uuidv4() } })
      ).rejects.toBeTruthy();
      expect(statusChanged()).toHaveLength(0);
      expect(await statusOf(ticketId)).toBe(statusOpen);
    });

    it('tickets.close publishes one TICKET_STATUS_CHANGED to the board closed status', async () => {
      const ticketId = await insertTicket({ status_id: statusProgress });
      const result: any = await runAction('tickets.close', {
        ticket_id: ticketId,
        resolution: { code: 'fixed', text: 'done' },
      });

      const finalStatus = await statusOf(ticketId);
      expect(finalStatus).toBe(result.final_status_id);
      expect([statusClosed, statusClosedB]).toContain(finalStatus);
      const events = statusChanged();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ ticketId, previousStatusId: statusProgress, newStatusId: finalStatus });
      expect(events[0].ctx.correlationId).toBe(runId);
    });
  });

  describe('bundle propagation (propagateBundleMasterStatus)', () => {
    async function bundle(masterStatus: string, childStatuses: string[]) {
      const masterId = await insertTicket({ status_id: masterStatus });
      const childIds: string[] = [];
      for (const s of childStatuses) childIds.push(await insertTicket({ status_id: s, master_ticket_id: masterId }));
      await scoped.table('ticket_bundle_settings').insert({ tenant, master_ticket_id: masterId, mode: 'sync_updates' });
      return { masterId, childIds };
    }

    it('boundary close publishes one TICKET_STATUS_CHANGED per open child with correct ids', async () => {
      const { propagateBundleMasterStatus } = await import('@alga-psa/tickets/actions/ticketBundleUtils');
      const { withTransaction } = await import('@alga-psa/db');
      const { masterId, childIds } = await bundle(statusOpen, [statusOpen, statusProgress]);

      await withTransaction(testDb, async (trx) => {
        await scoped.table('tickets').where({ ticket_id: masterId }).update({ status_id: statusClosed, is_closed: true });
        await propagateBundleMasterStatus(
          trx,
          { tenant, user: { user_id: actorId, first_name: 'Ada', last_name: 'Agent' } as any, previousMasterStatusId: statusOpen },
          masterId,
          { status_id: statusClosed },
          { propagateToChildren: true }
        );
        expect(statusChanged()).toHaveLength(0); // nothing before commit
      });

      const events = statusChanged();
      expect(events).toHaveLength(2);
      const byTicket = new Map(events.map((e) => [e.payload.ticketId, e.payload]));
      expect(byTicket.get(childIds[0])).toMatchObject({ previousStatusId: statusOpen, newStatusId: statusClosed });
      expect(byTicket.get(childIds[1])).toMatchObject({ previousStatusId: statusProgress, newStatusId: statusClosed });
    });

    it('non-boundary sync publishes only for children whose status actually changed', async () => {
      const { propagateBundleMasterStatus } = await import('@alga-psa/tickets/actions/ticketBundleUtils');
      const { withTransaction } = await import('@alga-psa/db');
      // The closed child keeps its status on a non-boundary master change; the open child follows the master.
      const { masterId, childIds } = await bundle(statusOpen, [statusOpen, statusClosed]);

      await withTransaction(testDb, async (trx) => {
        await scoped.table('tickets').where({ ticket_id: masterId }).update({ status_id: statusProgress });
        await propagateBundleMasterStatus(
          trx,
          { tenant, user: { user_id: actorId, first_name: 'Ada', last_name: 'Agent' } as any, previousMasterStatusId: statusOpen },
          masterId,
          { status_id: statusProgress }
        );
      });

      const events = statusChanged();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ ticketId: childIds[0], previousStatusId: statusOpen, newStatusId: statusProgress });
    });

    it('rolled-back propagation publishes nothing', async () => {
      const { propagateBundleMasterStatus } = await import('@alga-psa/tickets/actions/ticketBundleUtils');
      const { withTransaction } = await import('@alga-psa/db');
      const { masterId } = await bundle(statusOpen, [statusOpen]);

      await expect(
        withTransaction(testDb, async (trx) => {
          await scoped.table('tickets').where({ ticket_id: masterId }).update({ status_id: statusClosed, is_closed: true });
          await propagateBundleMasterStatus(
            trx,
            { tenant, user: { user_id: actorId } as any, previousMasterStatusId: statusOpen },
            masterId,
            { status_id: statusClosed },
            { propagateToChildren: true }
          );
          throw new Error('rollback');
        })
      ).rejects.toThrow('rollback');
      expect(statusChanged()).toHaveLength(0);
    });
  });

  describe('MSP update actions', () => {
    it('updateTicket publishes one TICKET_STATUS_CHANGED', async () => {
      const { updateTicket } = await import('@alga-psa/tickets/actions/ticketActions');
      const ticketId = await insertTicket();
      const result = await updateTicket(ticketId, { status_id: statusProgress });
      expect(result).toBe('success');
      expect(await statusOf(ticketId)).toBe(statusProgress);
      const events = statusChanged();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ ticketId, previousStatusId: statusOpen, newStatusId: statusProgress });
    });

    it('updateTicket publishes no status event for a non-status edit', async () => {
      const { updateTicket } = await import('@alga-psa/tickets/actions/ticketActions');
      const ticketId = await insertTicket();
      expect(await updateTicket(ticketId, { title: 'New title' })).toBe('success');
      expect(statusChanged()).toHaveLength(0);
    });

    it('updateTicketWithCache publishes one TICKET_STATUS_CHANGED', async () => {
      const { updateTicketWithCache } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
      const ticketId = await insertTicket();
      const result = await updateTicketWithCache(ticketId, { status_id: statusProgress });
      expect(result).toBe('success');
      const events = statusChanged();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ ticketId, previousStatusId: statusOpen, newStatusId: statusProgress });
    });

    it('updateTicketWithCache closing then reopening publishes one status event each (plus REOPENED)', async () => {
      const { updateTicketWithCache } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
      const ticketId = await insertTicket();
      expect(await updateTicketWithCache(ticketId, { status_id: statusClosed })).toBe('success');
      expect(statusChanged()).toHaveLength(1);
      expect(await updateTicketWithCache(ticketId, { status_id: statusOpen })).toBe('success');
      const events = statusChanged();
      expect(events).toHaveLength(2);
      expect(events[1].payload).toMatchObject({ previousStatusId: statusClosed, newStatusId: statusOpen });
      expect(workflowEvents.filter((e) => e.eventType === 'TICKET_REOPENED')).toHaveLength(1);
    });
  });

  describe('client portal updateTicketStatus', () => {
    it('publishes one TICKET_STATUS_CHANGED with the portal actor', async () => {
      const contactId = uuidv4();
      await scoped.table('contacts').insert({
        tenant, contact_name_id: contactId, client_id: clientId, full_name: 'Portal Person', email: `portal-${uuidv4().slice(0, 6)}@example.com`,
      });
      const portalUserId = uuidv4();
      await scoped.table('users').insert({
        tenant, user_id: portalUserId, username: `portal-${uuidv4().slice(0, 8)}`, hashed_password: 'x',
        email: `portal-${uuidv4().slice(0, 8)}@example.com`, first_name: 'Portal', last_name: 'Person',
        user_type: 'client', contact_id: contactId, is_inactive: false,
      });
      const ticketId = await insertTicket({ contact_name_id: contactId });
      const internalUser = currentUser;
      currentUser = { user_id: portalUserId, tenant, email: 'portal@example.com', first_name: 'Portal', last_name: 'Person', user_type: 'client', is_inactive: false, roles: [] };
      try {
        const { updateTicketStatus } = await import('@alga-psa/client-portal/actions/client-portal-actions/client-tickets');
        const result: any = await updateTicketStatus(ticketId, statusProgress);
        expect(result?.success ?? true).not.toBe(false);
      } finally {
        currentUser = internalUser;
      }
      expect(await statusOf(ticketId)).toBe(statusProgress);
      const events = statusChanged();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ ticketId, previousStatusId: statusOpen, newStatusId: statusProgress });
      expect(events[0].ctx.actor).toMatchObject({ actorType: 'USER', actorUserId: portalUserId });
    });
  });

  describe('REST TicketService.update', () => {
    it('publishes one TICKET_STATUS_CHANGED and carries the notification suppression flags', async () => {
      const { TicketService } = await import('../../lib/api/services/TicketService');
      const { runWithTenant } = await import('@alga-psa/db');
      const ticketId = await insertTicket();
      const service = new TicketService();
      await runWithTenant(tenant, () =>
        service.update(ticketId, { status_id: statusProgress } as any, { userId: actorId, tenant, user: currentUser } as any)
      );
      expect(await statusOf(ticketId)).toBe(statusProgress);
      const events = statusChanged();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ ticketId, previousStatusId: statusOpen, newStatusId: statusProgress });
      expect(events[0].payload).toHaveProperty('suppressContactNotifications');
    });

    it('publishes no status event when the status is unchanged', async () => {
      const { TicketService } = await import('../../lib/api/services/TicketService');
      const { runWithTenant } = await import('@alga-psa/db');
      const ticketId = await insertTicket();
      const service = new TicketService();
      await runWithTenant(tenant, () =>
        service.update(ticketId, { title: 'Renamed via REST' } as any, { userId: actorId, tenant, user: currentUser } as any)
      );
      expect(statusChanged()).toHaveLength(0);
    });
  });
});
