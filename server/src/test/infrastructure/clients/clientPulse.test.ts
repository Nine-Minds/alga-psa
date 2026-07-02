import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getCurrentUser } from '@alga-psa/auth';

const mockedTenantConnection = vi.hoisted(() => ({
  db: null as any,
  tenant: null as string | null,
}));

const permissionState = vi.hoisted(() => ({
  values: new Set<string>(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => {
      if (!mockedTenantConnection.db || !mockedTenantConnection.tenant) {
        throw new Error('Mock tenant connection not initialized');
      }

      return {
        knex: mockedTenantConnection.db,
        tenant: mockedTenantConnection.tenant,
      };
    }),
  };
});

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: any, resource: string, action: string) =>
    permissionState.values.has(`${resource}:${action}`)
  ),
}));

import { TestContext } from '../../../../test-utils/testContext';
import { createTestService } from '../../../../test-utils/billingTestHelpers';
import { getClientPulse } from '../../../../../packages/clients/src/actions/clientPulseActions';

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const NOW = new Date('2026-07-02T12:00:00.000Z');
const DAY_MS = 86_400_000;
const ALL_READ_PERMISSIONS = [
  'client:read',
  'ticket:read',
  'billing:read',
  'inventory:read',
  'asset:read',
  'document:read',
];

function setPermissions(values: string[] = ALL_READ_PERMISSIONS) {
  permissionState.values.clear();
  for (const value of values) {
    permissionState.values.add(value);
  }
}

function setPermissionsWithout(...omitted: string[]) {
  setPermissions(ALL_READ_PERMISSIONS.filter((value) => !omitted.includes(value)));
}

function suffix() {
  return randomUUID().slice(0, 8);
}

function isoOffset(days: number) {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString();
}

function dateOffset(days: number) {
  return isoOffset(days).slice(0, 10);
}

async function ensureInvoicePaymentsTable(context: TestContext) {
  if (await context.db.schema.hasTable('invoice_payments')) {
    return;
  }

  await context.db.schema.createTable('invoice_payments', (table) => {
    table.uuid('payment_id').defaultTo(context.db.raw('gen_random_uuid()')).primary();
    table.uuid('tenant').notNullable();
    table.uuid('invoice_id').notNullable();
    table.bigInteger('amount').notNullable();
    table.string('payment_method', 100);
    table.timestamp('payment_date', { useTz: true }).defaultTo(context.db.fn.now());
    table.string('reference_number', 255);
    table.text('notes');
    table.string('status', 50).defaultTo('completed');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).defaultTo(context.db.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(context.db.fn.now());

    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    table.foreign(['tenant', 'invoice_id']).references(['tenant', 'invoice_id']).inTable('invoices').onDelete('CASCADE');
  });
}

async function seedPriority(context: TestContext, name: string, orderNumber: number) {
  const priorityId = randomUUID();
  await context.db('priorities').insert({
    tenant: context.tenantId,
    priority_id: priorityId,
    priority_name: name,
    created_by: context.userId,
    order_number: orderNumber,
    color: orderNumber > 2 ? '#EF4444' : '#10B981',
    item_type: 'ticket',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  });
  return priorityId;
}

async function seedTicket(
  context: TestContext,
  input: {
    ticketNumber: string;
    title: string;
    enteredOffsetDays: number;
    dueOffsetDays?: number | null;
    priorityId?: string | null;
    isClosed?: boolean;
  },
) {
  const ticketId = randomUUID();
  const isClosed = input.isClosed ?? false;
  await context.db('tickets').insert({
    tenant: context.tenantId,
    ticket_id: ticketId,
    ticket_number: input.ticketNumber,
    title: input.title,
    client_id: context.clientId,
    priority_id: input.priorityId ?? null,
    entered_at: isoOffset(input.enteredOffsetDays),
    due_date: input.dueOffsetDays == null ? null : isoOffset(input.dueOffsetDays),
    is_closed: isClosed,
    closed_at: isClosed ? isoOffset(-1) : null,
    updated_at: NOW.toISOString(),
  });
  return ticketId;
}

async function seedTicketComment(
  context: TestContext,
  ticketId: string,
  authorType: 'internal' | 'client',
  createdOffsetDays: number,
) {
  const commentId = randomUUID();
  const threadId = randomUUID();
  const createdAt = isoOffset(createdOffsetDays);

  await context.db('comment_threads').insert({
    tenant: context.tenantId,
    thread_id: threadId,
    ticket_id: ticketId,
    project_task_id: null,
    root_comment_id: commentId,
    is_internal: authorType === 'internal',
    reply_count: 0,
    last_activity_at: createdAt,
    created_at: createdAt,
    created_by: authorType === 'internal' ? context.userId : null,
  });

  await context.db('comments').insert({
    tenant: context.tenantId,
    comment_id: commentId,
    ticket_id: ticketId,
    thread_id: threadId,
    user_id: authorType === 'internal' ? context.userId : null,
    note: `${authorType} pulse fixture comment`,
    is_internal: authorType === 'internal',
    is_resolution: false,
    is_system_generated: false,
    author_type: authorType,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

async function seedContact(context: TestContext, fullName: string, email: string, role: string, isInactive = false) {
  const contactId = randomUUID();
  await context.db('contacts').insert({
    tenant: context.tenantId,
    contact_name_id: contactId,
    client_id: context.clientId,
    full_name: fullName,
    email,
    role,
    is_inactive: isInactive,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  });
  return contactId;
}

async function seedLocation(context: TestContext, name: string, isDefault: boolean) {
  const locationId = randomUUID();
  await context.db('client_locations').insert({
    tenant: context.tenantId,
    location_id: locationId,
    client_id: context.clientId,
    location_name: name,
    address_line1: `${name} Street`,
    city: 'New York',
    country_code: 'US',
    country_name: 'United States',
    is_default: isDefault,
    is_billing_address: isDefault,
    is_shipping_address: !isDefault,
    is_active: true,
    phone: '555-0100',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  });
  return locationId;
}

async function setDefaultContact(context: TestContext, contactId: string) {
  await context.db('clients')
    .where({ tenant: context.tenantId, client_id: context.clientId })
    .update({
      properties: { primary_contact_id: contactId },
      account_manager_id: context.userId,
      created_at: isoOffset(-365),
      updated_at: NOW.toISOString(),
    });
}

async function seedInvoice(
  context: TestContext,
  input: {
    invoiceNumber: string;
    totalCents: number;
    dueOffsetDays: number;
    createdOffsetDays: number;
    status?: string;
    finalized?: boolean;
    creditApplied?: number;
  },
) {
  const invoiceId = randomUUID();
  const finalized = input.finalized ?? false;
  await context.db('invoices').insert({
    tenant: context.tenantId,
    invoice_id: invoiceId,
    client_id: context.clientId,
    invoice_number: input.invoiceNumber,
    invoice_date: dateOffset(-30),
    due_date: dateOffset(input.dueOffsetDays),
    total_amount: input.totalCents,
    credit_applied: input.creditApplied ?? 0,
    status: input.status ?? (finalized ? 'sent' : 'draft'),
    finalized_at: finalized ? isoOffset(input.createdOffsetDays) : null,
    currency_code: 'USD',
    is_prepayment: false,
    created_at: isoOffset(input.createdOffsetDays),
    updated_at: NOW.toISOString(),
  });
  return invoiceId;
}

async function seedPayment(context: TestContext, invoiceId: string, amount: number, status = 'completed') {
  await context.db('invoice_payments').insert({
    tenant: context.tenantId,
    invoice_id: invoiceId,
    amount,
    payment_method: 'check',
    payment_date: isoOffset(-1),
    reference_number: `PAY-${suffix()}`,
    status,
  });
}

async function seedDeliveredUnit(context: TestContext, serviceId: string, serialNumber: string) {
  const unitId = randomUUID();
  await context.db('stock_units').insert({
    tenant: context.tenantId,
    unit_id: unitId,
    service_id: serviceId,
    serial_number: serialNumber,
    status: 'delivered',
    client_id: context.clientId,
    delivered_at: isoOffset(-2),
    unit_cost: 2500,
    cost_currency: 'USD',
    created_at: isoOffset(-3),
    updated_at: NOW.toISOString(),
  });
  return unitId;
}

async function seedPartialSalesOrder(context: TestContext, serviceId: string, soNumber: string) {
  const soId = randomUUID();
  await context.db('sales_orders').insert({
    tenant: context.tenantId,
    so_id: soId,
    so_number: soNumber,
    client_id: context.clientId,
    status: 'partially_fulfilled',
    order_date: dateOffset(-5),
    currency_code: 'USD',
    created_by: context.userId,
    created_at: isoOffset(-5),
    updated_at: NOW.toISOString(),
  });

  await context.db('sales_order_lines').insert([
    {
      tenant: context.tenantId,
      so_line_id: randomUUID(),
      so_id: soId,
      service_id: serviceId,
      quantity_ordered: 1,
      quantity_fulfilled: 1,
      quantity_invoiced: 0,
      unit_price: 1000,
      fulfillment_type: 'from_stock',
      created_at: isoOffset(-5),
      updated_at: NOW.toISOString(),
    },
    {
      tenant: context.tenantId,
      so_line_id: randomUUID(),
      so_id: soId,
      service_id: serviceId,
      quantity_ordered: 1,
      quantity_fulfilled: 0,
      quantity_invoiced: 0,
      unit_price: 1000,
      fulfillment_type: 'from_stock',
      created_at: isoOffset(-5),
      updated_at: NOW.toISOString(),
    },
  ]);

  return soId;
}

async function seedOpenRma(context: TestContext, serviceId: string, reference: string) {
  const rmaId = randomUUID();
  await context.db('rma_cases').insert({
    tenant: context.tenantId,
    rma_id: rmaId,
    rma_type: 'standard',
    service_id: serviceId,
    client_id: context.clientId,
    rma_reference: reference,
    reason: 'Pulse fixture RMA',
    status: 'open',
    opened_at: isoOffset(-8),
    created_by: context.userId,
    created_at: isoOffset(-8),
    updated_at: NOW.toISOString(),
  });
  return rmaId;
}

describe('client pulse infrastructure', () => {
  let context: TestContext;
  let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantConnection.db = context.db;
    mockedTenantConnection.tenant = context.tenantId;
    setPermissions();
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
    await ensureInvoicePaymentsTable(context);
    vi.mocked(getCurrentUser).mockResolvedValue({
      ...context.user,
      user_id: context.userId,
      tenant: context.tenantId,
      roles: [],
    } as any);
  }, 30000);

  afterEach(async () => {
    dateNowSpy?.mockRestore();
    dateNowSpy = null;
    mockedTenantConnection.db = null;
    mockedTenantConnection.tenant = null;
    permissionState.values.clear();
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 120000);

  it('T001: aggregates happy-path service, billing, inventory, people, locations, and flags', async () => {
    const id = suffix();
    const defaultContactId = await seedContact(context, 'Alice Default', `alice-${id}@example.com`, 'Owner');
    await seedContact(context, 'Bob Active', `bob-${id}@example.com`, 'Operations');
    await seedContact(context, 'Inactive Contact', `inactive-${id}@example.com`, 'Former', true);
    await setDefaultContact(context, defaultContactId);

    const defaultLocationId = await seedLocation(context, `HQ ${id}`, true);
    await seedLocation(context, `Warehouse ${id}`, false);

    const highPriorityId = await seedPriority(context, `Pulse High ${id}`, 4);
    const lowPriorityId = await seedPriority(context, `Pulse Low ${id}`, 1);
    const overdueTicketNumber = `T001-${id}`;
    const overdueTicketId = await seedTicket(context, {
      ticketNumber: overdueTicketNumber,
      title: 'Overdue network outage',
      enteredOffsetDays: -7,
      dueOffsetDays: -3,
      priorityId: highPriorityId,
    });
    await seedTicket(context, {
      ticketNumber: `T001-LOW-${id}`,
      title: 'Future low priority',
      enteredOffsetDays: -10,
      dueOffsetDays: 2,
      priorityId: lowPriorityId,
    });

    const draftInvoiceId = await seedInvoice(context, {
      invoiceNumber: `INV-T001-${id}`,
      totalCents: 12345,
      dueOffsetDays: 15,
      createdOffsetDays: -1,
      status: 'draft',
      finalized: false,
    });

    const serviceId = await createTestService(context, {
      service_name: `Pulse Router ${id}`,
      default_rate: 25000,
      unit_of_measure: 'each',
    });
    await seedDeliveredUnit(context, serviceId, `SN-T001-${id}`);

    const pulse = await getClientPulse(context.clientId);

    expect(pulse.permissions).toEqual({
      tickets: true,
      billing: true,
      inventory: true,
      assets: true,
      documents: true,
    });
    expect(pulse.service?.openCount).toBe(2);
    expect(pulse.service?.oldestOpenDays).toBe(10);
    expect(pulse.service?.overdueCount).toBe(1);
    expect(pulse.service?.topOpen[0]).toMatchObject({
      ticket_id: overdueTicketId,
      ticket_number: overdueTicketNumber,
      priority_name: `Pulse High ${id}`,
      is_overdue: true,
    });
    expect(pulse.money?.draftInvoices).toHaveLength(1);
    expect(pulse.money?.draftInvoices[0]).toMatchObject({
      invoice_id: draftInvoiceId,
      invoice_number: `INV-T001-${id}`,
      totalCents: 12345,
    });
    expect(pulse.installBase?.soldUnitCount).toBe(1);
    expect(pulse.installBase?.recentUnits[0]).toMatchObject({
      product_name: `Pulse Router ${id}`,
      serial_number: `SN-T001-${id}`,
    });
    expect(pulse.people.totalCount).toBe(2);
    expect(pulse.people.top[0]).toMatchObject({
      contact_name_id: defaultContactId,
      full_name: 'Alice Default',
      is_default: true,
    });
    expect(pulse.locations).toHaveLength(2);
    expect(pulse.locations[0]).toMatchObject({
      location_id: defaultLocationId,
      is_default: true,
      is_billing: true,
    });

    const draftFlag = pulse.attention.find((flag) => flag.kind === 'draft_invoices');
    expect(draftFlag).toMatchObject({
      severity: 'amber',
      count: 1,
      amountCents: 12345,
      refType: 'invoice',
      refId: draftInvoiceId,
      refLabel: `INV-T001-${id}`,
    });

    const overdueFlag = pulse.attention.find((flag) => flag.kind === 'ticket_overdue');
    expect(overdueFlag).toMatchObject({
      severity: 'blue',
      count: 1,
      refType: 'ticket',
      refId: overdueTicketId,
      refLabel: `#${overdueTicketNumber}`,
      daysAgo: 3,
    });
  });

  it('T002: computes aging buckets from finalized invoice balances, credits, and completed payments', async () => {
    const id = suffix();
    const currentInvoiceId = await seedInvoice(context, {
      invoiceNumber: `INV-CUR-${id}`,
      totalCents: 10000,
      dueOffsetDays: 10,
      createdOffsetDays: -4,
      finalized: true,
    });
    const d30InvoiceId = await seedInvoice(context, {
      invoiceNumber: `INV-D30-${id}`,
      totalCents: 20000,
      dueOffsetDays: -10,
      createdOffsetDays: -3,
      finalized: true,
    });
    await seedInvoice(context, {
      invoiceNumber: `INV-D60-${id}`,
      totalCents: 30000,
      creditApplied: 5000,
      dueOffsetDays: -45,
      createdOffsetDays: -2,
      finalized: true,
    });
    await seedInvoice(context, {
      invoiceNumber: `INV-D90-${id}`,
      totalCents: 40000,
      dueOffsetDays: -100,
      createdOffsetDays: -1,
      finalized: true,
    });
    await seedPayment(context, d30InvoiceId, 5000, 'completed');
    await seedPayment(context, currentInvoiceId, 7000, 'pending');

    const pulse = await getClientPulse(context.clientId);

    expect(pulse.money?.aging).toEqual({
      currentCents: 10000,
      d30Cents: 15000,
      d60Cents: 25000,
      d90PlusCents: 40000,
    });
    expect(pulse.money?.outstandingTotalCents).toBe(90000);
    expect(pulse.money?.unpaidInvoiceCount).toBe(4);
    expect(pulse.money?.currencyCode).toBe('USD');
  });

  it('T003: omits restricted sections and their flags when optional read permissions are absent', async () => {
    const id = suffix();
    await seedInvoice(context, {
      invoiceNumber: `INV-RBAC-${id}`,
      totalCents: 45000,
      dueOffsetDays: 7,
      createdOffsetDays: -1,
      status: 'draft',
      finalized: false,
    });

    const serviceId = await createTestService(context, {
      service_name: `Pulse Firewall ${id}`,
      default_rate: 50000,
      unit_of_measure: 'each',
    });
    await seedPartialSalesOrder(context, serviceId, `SO-RBAC-${id}`);
    await seedOpenRma(context, serviceId, `RMA-RBAC-${id}`);

    setPermissionsWithout('billing:read');
    const noBilling = await getClientPulse(context.clientId);
    expect(noBilling.permissions.billing).toBe(false);
    expect(noBilling.money).toBeUndefined();
    expect(noBilling.installBase).toBeDefined();
    expect(noBilling.attention.some((flag) => flag.kind === 'draft_invoices')).toBe(false);
    expect(noBilling.attention.some((flag) => flag.kind === 'so_partial')).toBe(true);
    expect(noBilling.attention.some((flag) => flag.kind === 'rma_open')).toBe(true);

    setPermissionsWithout('inventory:read');
    const noInventory = await getClientPulse(context.clientId);
    expect(noInventory.permissions.inventory).toBe(false);
    expect(noInventory.money).toBeDefined();
    expect(noInventory.installBase).toBeUndefined();
    expect(noInventory.attention.some((flag) => flag.kind === 'draft_invoices')).toBe(true);
    expect(noInventory.attention.some((flag) => flag.kind === 'so_partial')).toBe(false);
    expect(noInventory.attention.some((flag) => flag.kind === 'rma_open')).toBe(false);
  });

  it('T004: emits client_waiting only for open tickets whose latest comment is from the client', async () => {
    const id = suffix();
    const waitingTicketNumber = `T004-WAIT-${id}`;
    const waitingTicketId = await seedTicket(context, {
      ticketNumber: waitingTicketNumber,
      title: 'Waiting on client reply',
      enteredOffsetDays: -9,
      dueOffsetDays: 4,
    });
    await seedTicketComment(context, waitingTicketId, 'internal', -5);
    await seedTicketComment(context, waitingTicketId, 'client', -2);

    const internalLatestTicketId = await seedTicket(context, {
      ticketNumber: `T004-INTERNAL-${id}`,
      title: 'Internal latest comment',
      enteredOffsetDays: -8,
      dueOffsetDays: 4,
    });
    await seedTicketComment(context, internalLatestTicketId, 'client', -6);
    await seedTicketComment(context, internalLatestTicketId, 'internal', -1);

    const closedTicketId = await seedTicket(context, {
      ticketNumber: `T004-CLOSED-${id}`,
      title: 'Closed with client comment',
      enteredOffsetDays: -10,
      dueOffsetDays: -4,
      isClosed: true,
    });
    await seedTicketComment(context, closedTicketId, 'client', -3);

    const pulse = await getClientPulse(context.clientId);
    const waitingFlag = pulse.attention.find((flag) => flag.kind === 'client_waiting');

    expect(waitingFlag).toMatchObject({
      severity: 'blue',
      count: 1,
      refType: 'ticket',
      refId: waitingTicketId,
      refLabel: `#${waitingTicketNumber}`,
      daysAgo: 2,
    });
  });
});
