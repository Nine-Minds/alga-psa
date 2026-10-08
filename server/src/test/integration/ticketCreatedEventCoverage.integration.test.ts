import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withTransaction } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Ticket creation sites must publish TICKET_CREATED (one per created ticket, after commit) through a
 * real publisher, except where the silent marker is an explicit, justified opt-out.
 * `@alga-psa/event-bus/publishers` is mocked and captured; the DB is real.
 */
let testDb: Knex;
type BusEvent = { eventType: string; payload: Record<string, any>; options?: Record<string, any> };
const busEvents: BusEvent[] = [];

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/event-bus/publishers')>()),
  publishEvent: vi.fn(async (event: any, options?: any) => {
    busEvents.push({ eventType: event.eventType, payload: event.payload, options });
  }),
  publishWorkflowEvent: vi.fn(async (params: any, options?: any) => {
    busEvents.push({
      eventType: params.eventType,
      payload: params.payload,
      options: { ...options, workflow: { executionId: params.ctx?.correlationId } },
    });
  }),
}));

vi.mock('../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db/db')>()),
  getConnection: async () => testDb,
}));
vi.mock('../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db')>()),
  createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant }),
}));

vi.mock('../../../../shared/workflow/runtime/actions/businessOperations/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../shared/workflow/runtime/actions/businessOperations/shared')>()),
  requirePermission: vi.fn(async () => {}),
}));

const repoRoot = path.resolve(__dirname, '../../../..');
const readSource = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('TICKET_CREATED coverage across creation sites (integration)', () => {
  let tenant: string;
  let scoped: ReturnType<typeof tenantDb>;
  let clientId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let actorId: string;
  let runId: string;
  const created = () => busEvents.filter((e) => e.eventType === 'TICKET_CREATED');

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    tenant = await createTenant(testDb, `CreatedCoverage ${uuidv4().slice(0, 6)}`);
    scoped = tenantDb(testDb, tenant);
    clientId = await createClient(testDb, tenant, 'Acme');
    actorId = await createUser(testDb, tenant, { email: 'actor@example.com' });
    boardId = uuidv4();
    statusId = uuidv4();
    priorityId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Main', is_default: true });
    await scoped.table('statuses').insert({
      tenant, status_id: statusId, board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket',
      order_number: 1, is_default: true, is_closed: false,
    });
    await scoped.table('priorities').insert({
      tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: actorId,
    });

    const workflowId = uuidv4();
    await scoped.table('workflow_definitions').insert({
      workflow_id: workflowId, tenant, name: 'Created coverage', description: null, payload_schema_ref: 'schema://test',
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
    if (!getActionRegistryV2().get('tickets.create', 1)) registerTicketActions();
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy().catch(() => undefined);
  });

  beforeEach(() => {
    busEvents.length = 0;
  });

  const baseInput = (title: string) => ({
    title,
    client_id: clientId,
    board_id: boardId,
    status_id: statusId,
    priority_id: priorityId,
    description: 'x',
    entered_by: actorId,
  });

  describe('TicketModel.createTicket', () => {
    it('publishes exactly one TICKET_CREATED after commit with a real publisher', async () => {
      const { TicketModel } = await import('../../../../shared/models/ticketModel');
      const { WorkflowEventPublisher } = await import('../../../../shared/workflow/adapters/workflowEventPublisher');
      let ticketId = '';
      await withTransaction(testDb, async (trx) => {
        const result = await TicketModel.createTicket(
          baseInput('Real publisher'), tenant, trx, {}, new WorkflowEventPublisher({ transaction: trx }), undefined, actorId
        );
        ticketId = result.ticket_id;
        expect(created()).toHaveLength(0); // deferred until commit
      });
      expect(created()).toHaveLength(1);
      expect(created()[0].payload).toMatchObject({ tenantId: tenant, ticketId, userId: actorId, board_id: boardId, client_id: clientId });
      expect(created()[0].options?.workflow?.executionId).toBeUndefined();
    });

    it('publishes nothing when the owning transaction rolls back', async () => {
      const { TicketModel } = await import('../../../../shared/models/ticketModel');
      const { WorkflowEventPublisher } = await import('../../../../shared/workflow/adapters/workflowEventPublisher');
      await expect(
        withTransaction(testDb, async (trx) => {
          await TicketModel.createTicket(
            baseInput('Rolled back'), tenant, trx, {}, new WorkflowEventPublisher({ transaction: trx }), undefined, actorId
          );
          throw new Error('rollback');
        })
      ).rejects.toThrow('rollback');
      expect(created()).toHaveLength(0);
    });

    it('silentTicketCreation publishes nothing but still creates the ticket', async () => {
      const { TicketModel } = await import('../../../../shared/models/ticketModel');
      const { silentTicketCreation } = await import('../../../../shared/lib/tickets/ticketLifecycleEvents');
      let ticketId = '';
      await withTransaction(testDb, async (trx) => {
        ticketId = (await TicketModel.createTicket(
          baseInput('Silent'), tenant, trx, {}, silentTicketCreation('test'), undefined, actorId
        )).ticket_id;
      });
      expect(created()).toHaveLength(0);
      expect(await scoped.table('tickets').where({ ticket_id: ticketId }).first()).toBeTruthy();
    });

    it('ticketCreatedPublishedByCaller makes the model publish nothing (caller owns the event)', async () => {
      const { TicketModel } = await import('../../../../shared/models/ticketModel');
      const { ticketCreatedPublishedByCaller } = await import('../../../../shared/lib/tickets/ticketLifecycleEvents');
      await withTransaction(testDb, async (trx) => {
        await TicketModel.createTicket(
          baseInput('Caller published'), tenant, trx, {}, ticketCreatedPublishedByCaller('test'), undefined, actorId
        );
      });
      expect(created()).toHaveLength(0);
    });
  });

  const expectContactSuppressedOnly = (payload: Record<string, any>) => {
    expect(payload.suppressContactNotifications).toBe(true);
    expect(payload.suppressInternalNotifications).not.toBe(true);
  };

  describe('contactSuppressedTicketCreation', () => {
    it('publishes TICKET_CREATED with suppressContactNotifications only, keeping the standard metadata', async () => {
      const { TicketModel } = await import('../../../../shared/models/ticketModel');
      const { WorkflowEventPublisher } = await import('../../../../shared/workflow/adapters/workflowEventPublisher');
      const { contactSuppressedTicketCreation } = await import('../../../../shared/lib/tickets/ticketLifecycleEvents');
      let ticketId = '';
      await withTransaction(testDb, async (trx) => {
        ticketId = (await TicketModel.createTicket(
          baseInput('Contact suppressed'), tenant, trx, {},
          contactSuppressedTicketCreation(new WorkflowEventPublisher({ transaction: trx }), 'test'), undefined, actorId
        )).ticket_id;
      });
      expect(created()).toHaveLength(1);
      expect(created()[0].payload).toMatchObject({ tenantId: tenant, ticketId, board_id: boardId, client_id: clientId });
      expectContactSuppressedOnly(created()[0].payload);
    });

    it('a plain publisher still publishes no suppression flag (existing sources unchanged)', async () => {
      const { TicketModel } = await import('../../../../shared/models/ticketModel');
      const { WorkflowEventPublisher } = await import('../../../../shared/workflow/adapters/workflowEventPublisher');
      await withTransaction(testDb, async (trx) => {
        await TicketModel.createTicket(
          baseInput('Plain'), tenant, trx, {}, new WorkflowEventPublisher({ transaction: trx }), undefined, actorId
        );
      });
      expect(created()[0].payload.suppressContactNotifications).toBeUndefined();
      expect(created()[0].payload.suppressInternalNotifications).toBeUndefined();
    });
  });

  describe('newly publishing sources suppress contact notifications', () => {
    it.each([
      ['manual telephony ticket', 'packages/integrations/src/actions/integrations/telephonyActions.ts'],
      ['auto telephony ticket', 'packages/telephony/src/services/autoTicketFromCall.ts'],
      ['inbound webhook create', 'packages/tickets/src/actions/inboundActions.ts'],
      ['Teams guest intake', 'ee/packages/microsoft-teams/src/lib/teams/bot/teamsGuestIntake.ts'],
    ])('%s creates through contactSuppressedTicketCreation', (_name, file) => {
      const src = readSource(file);
      expect(src).toMatch(
        /createTicket(WithRetry)?\([\s\S]{0,900}contactSuppressedTicketCreation\(\s*new WorkflowEventPublisher\(/
      );
    });

    it('renewal tickets create through createRenewalTicket with contact notifications suppressed', () => {
      expect(readSource('shared/billingClients/renewalTicket.ts')).toMatch(
        /createTicketWithSideEffects\([\s\S]{0,1500}suppressContactNotifications: true/
      );
      for (const file of [
        'packages/billing/src/actions/renewalsQueueActions.ts',
        'packages/jobs/src/lib/handlers/processRenewalQueueHandler.ts',
      ]) {
        expect(readSource(file)).toMatch(/createRenewalTicket\(/);
      }
    });

    it('workflow tickets.create goes through createTicketWithSideEffects', () => {
      expect(readSource('shared/workflow/runtime/actions/businessOperations/tickets.ts')).toMatch(
        /createTicketWithSideEffects\([\s\S]{0,2500}suppressContactNotifications/
      );
    });

    it('ticket-only service request provider publishes with suppressContactNotifications: true', () => {
      const src = readSource('server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts');
      expect(src).toMatch(/publishTicketCreated\([\s\S]{0,600}suppressContactNotifications: true/);
      expect(src).not.toMatch(/suppressInternalNotifications: true/);
    });
  });

  describe('silent opt-outs are explicit', () => {
    it('ticketImportActions creates tickets with silentTicketCreation', () => {
      const src = readSource('packages/tickets/src/actions/ticketImportActions.ts');
      expect(src).toMatch(/import \{ silentTicketCreation \} from '@alga-psa\/shared\/lib\/tickets\/ticketLifecycleEvents'/);
      expect(src).toMatch(/TicketModel\.createTicket\([\s\S]{0,400}silentTicketCreation\('[^']+'\)/);
    });

    it('migration entityAppliers create tickets with silentTicketCreation', () => {
      const src = readSource('server/src/lib/migrations/appliers/entityAppliers.ts');
      expect(src).toMatch(/import \{ silentTicketCreation \} from '@alga-psa\/shared\/lib\/tickets\/ticketLifecycleEvents'/);
      expect(src).toMatch(/TicketModel\.createTicket\([\s\S]{0,800}silentTicketCreation\('[^']+'\)/);
    });

    it('REST TicketService hands TICKET_CREATED to itself via ticketCreatedPublishedByCaller and publishes it', () => {
      const src = readSource('server/src/lib/api/services/TicketService.ts');
      expect(src.match(/ticketCreatedPublishedByCaller\(/g)?.length).toBeGreaterThanOrEqual(2);
      expect(src.match(/safePublishEvent\('TICKET_CREATED'/g)?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('representative real sites', () => {
    it('workflow tickets.create publishes one TICKET_CREATED carrying the run id as workflowRunId provenance', async () => {
      const { getActionRegistryV2 } = await import('../../../../shared/workflow/runtime/registries/actionRegistry');
      const action = getActionRegistryV2().get('tickets.create', 1)!;
      const result: any = await action.handler(
        action.inputSchema.parse({
          client_id: clientId, title: 'From workflow', description: 'x', board_id: boardId, status_id: statusId, priority_id: priorityId,
        }),
        {
          runId, stepPath: 'steps.create', idempotencyKey: uuidv4(), attempt: 1, nowIso: () => new Date().toISOString(),
          env: {}, tenantId: tenant, knex: testDb,
        } as any
      );
      const events = created();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ tenantId: tenant, ticketId: result.ticket_id });
      expect(events[0].payload.workflowRunId).toBe(runId);
      expectContactSuppressedOnly(events[0].payload);
    });

    it('telephony autoCreateTicketForCall publishes one TICKET_CREATED and none on the already-ticketed replay', async () => {
      const { autoCreateTicketForCall } = await import('../../../../packages/telephony/src/services/autoTicketFromCall');
      const callRecordId = uuidv4();
      await scoped.table('telephony_call_records').insert({
        tenant, call_record_id: callRecordId, provider: 'test', provider_call_id: `c-${uuidv4()}`, direction: 'inbound',
        caller_number_e164: '+15555550100', callee_number_e164: '+15555550199', match_status: 'matched', matched_client_id: clientId,
      });
      const input = { tenantId: tenant, callRecordId, defaults: { boardId, statusId, priorityId }, knex: testDb };

      const outcome: any = await autoCreateTicketForCall(input);
      expect(outcome.status).toBe('created');
      expect(created()).toHaveLength(1);
      expect(created()[0].payload.ticketId).toBe(outcome.ticketId);
      expectContactSuppressedOnly(created()[0].payload);

      busEvents.length = 0;
      expect(((await autoCreateTicketForCall(input)) as any).status).toBe('skipped');
      expect(created()).toHaveLength(0);
    });
  });
});
