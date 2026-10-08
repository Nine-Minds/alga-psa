import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Renewal ticket creation (scheduled job and manual retry) against a real, migrated database.
 * Both paths create the ticket through createTicketWithSideEffects inside an owning withTransaction
 * frame, so TICKET_CREATED / TICKET_ASSIGNED are published after commit. The bus is captured.
 */
const published: Array<{ eventType: string; payload: Record<string, any> }> = [];
const state = vi.hoisted(() => ({ db: null as any, user: null as any, tenant: '' }));

vi.mock('@alga-psa/event-bus/publishers', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/event-bus/publishers')>(
    '@alga-psa/event-bus/publishers'
  );
  const capture = async (event: { eventType: string; payload: Record<string, any> }) => {
    published.push({ eventType: event.eventType, payload: event.payload });
  };
  return { ...actual, publishEvent: vi.fn(capture), publishWorkflowEvent: vi.fn(capture) };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: state.db, tenant: state.tenant })) };
});

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    withAuth: (fn: any) => (...args: any[]) => fn(state.user, { tenant: state.tenant }, ...args),
  };
});

vi.mock('@alga-psa/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth/rbac')>();
  return { ...actual, hasPermission: vi.fn(async () => true) };
});

let db: Knex;

const dateOnly = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function createFixture() {
  const tenant = await createTenant(db, `Renewal ${uuidv4().slice(0, 6)}`);
  const clientId = await createClient(db, tenant, 'Acme Corp');
  const assigneeId = await createUser(db, tenant);
  const billingUserId = await createUser(db, tenant);
  const scoped = tenantDb(db, tenant);

  const boardId = uuidv4();
  await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Billing', is_default: true });
  const statusId = uuidv4();
  await scoped.table('statuses').insert({
    tenant, status_id: statusId, board_id: boardId, name: 'New', status_type: 'ticket',
    item_type: 'ticket', order_number: 1, is_default: true, is_closed: false,
  });
  const priorityId = uuidv4();
  await scoped.table('priorities').insert({
    tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket',
    order_number: 1, color: '#ccc', created_by: assigneeId,
  });
  await scoped.table('default_billing_settings').insert({
    tenant,
    renewal_due_date_action_policy: 'create_ticket',
    renewal_ticket_board_id: boardId,
    renewal_ticket_status_id: statusId,
    renewal_ticket_priority: priorityId,
    renewal_ticket_assignee_id: assigneeId,
  });

  const contractId = uuidv4();
  await scoped.table('contracts').insert({
    contract_id: contractId, tenant, contract_name: 'Managed Services', billing_frequency: 'monthly',
    is_active: true, status: 'active', is_template: false, currency_code: 'USD',
  });
  const clientContractId = uuidv4();
  await scoped.table('client_contracts').insert({
    client_contract_id: clientContractId, tenant, client_id: clientId, contract_id: contractId,
    start_date: dateOnly(-300), end_date: dateOnly(30), is_active: true, status: 'pending',
    po_required: false, renewal_mode: 'manual', notice_period_days: 30, use_tenant_renewal_defaults: true,
  });
  state.db = db;
  state.tenant = tenant;
  state.user = { user_id: billingUserId, tenant, user_type: 'internal' };
  return { tenant, clientId, assigneeId, billingUserId, clientContractId };
}

describe('renewal ticket events (integration)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  }, 900_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(() => {
    published.length = 0;
  });

  it('scheduled job: SYSTEM-created ticket, linked to the contract, events published once', async () => {
    const f = await createFixture();
    const { processRenewalQueueHandler } = await import(
      '../../../../packages/jobs/src/lib/handlers/processRenewalQueueHandler'
    );
    await processRenewalQueueHandler({ tenantId: f.tenant });

    const scoped = tenantDb(db, f.tenant);
    const contract = await scoped.table('client_contracts').where({ client_contract_id: f.clientContractId }).first();
    expect(contract.created_ticket_id).toBeTruthy();
    expect(contract.automation_error).toBeNull();

    const ticket = await scoped.table('tickets').where({ ticket_id: contract.created_ticket_id }).first();
    expect(ticket).toMatchObject({ entered_by: null, source: 'renewal_due_date_automation', assigned_to: f.assigneeId });

    const activity = await scoped.table('ticket_audit_logs')
      .where({ ticket_id: ticket.ticket_id, event_type: 'TICKET_CREATED' }).first();
    expect(activity).toMatchObject({ actor_type: 'system' });

    const created = published.filter((e) => e.eventType === 'TICKET_CREATED');
    expect(created).toHaveLength(1);
    expect(created[0].payload).toMatchObject({
      tenantId: f.tenant, ticketId: ticket.ticket_id, suppressContactNotifications: true,
    });
    expect(created[0].payload.userId).toBeUndefined();
    expect(published.filter((e) => e.eventType === 'TICKET_ASSIGNED')).toHaveLength(1);

    published.length = 0;
    await processRenewalQueueHandler({ tenantId: f.tenant });
    const count = Number((await scoped.table('tickets').count('* as n').first())?.n ?? 0);
    expect(count).toBe(1);
    expect(published).toHaveLength(0);
  });

  it('manual retry: ticket entered by the billing user, USER-attributed events', async () => {
    const f = await createFixture();
    const { retryRenewalQueueTicketCreation } = await import(
      '../../../../packages/billing/src/actions/renewalsQueueActions'
    );
    const result: any = await (retryRenewalQueueTicketCreation as any)(f.clientContractId);
    expect(result).toMatchObject({ retried: true, automation_error: null });
    expect(result.created_ticket_id).toBeTruthy();

    const scoped = tenantDb(db, f.tenant);
    const ticket = await scoped.table('tickets').where({ ticket_id: result.created_ticket_id }).first();
    expect(ticket).toMatchObject({
      entered_by: f.billingUserId, source: 'renewal_due_date_manual_retry', assigned_to: f.assigneeId,
    });

    const created = published.filter((e) => e.eventType === 'TICKET_CREATED');
    expect(created).toHaveLength(1);
    expect(created[0].payload).toMatchObject({
      ticketId: ticket.ticket_id, userId: f.billingUserId, suppressContactNotifications: true,
    });
    expect(published.filter((e) => e.eventType === 'TICKET_ASSIGNED')).toHaveLength(1);
  });
});
