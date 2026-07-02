import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mockedTenantConnection = vi.hoisted(() => ({
  db: null as any,
  tenant: null as string | null,
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

import { TestContext } from '../../../../test-utils/testContext';
import { createTestService } from '../../../../test-utils/billingTestHelpers';
import {
  createMockUser,
  setupCommonMocks,
} from '../../../../test-utils/testMocks';
import type { ClientTimelineEventType } from '../../../../../packages/clients/src/lib/commandCenterTypes';
import { listClientTimeline } from '../../../../../packages/clients/src/actions/clientTimelineActions';

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const BASE_TIME = Date.parse('2026-07-02T12:00:00.000Z');
const ALL_READ: Array<[string, string]> = [
  ['client', 'read'],
  ['ticket', 'read'],
  ['billing', 'read'],
  ['inventory', 'read'],
];

describe('Client timeline infrastructure', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantConnection.db = context.db;
    mockedTenantConnection.tenant = context.tenantId;
    setPermissions(ALL_READ);
  }, 30000);

  afterEach(async () => {
    mockedTenantConnection.db = null;
    mockedTenantConnection.tenant = null;
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 120000);

  function at(minutes: number): string {
    return new Date(BASE_TIME + minutes * 60_000).toISOString();
  }

  function setPermissions(permissions: Array<[string, string]>): void {
    const allowed = new Set(permissions.map(([resource, action]) => `${resource}:${action}`));

    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: createMockUser('internal', {
        tenant: context.tenantId,
        user_id: context.userId,
      }),
      permissionCheck: (_user, resource, action) => {
        if (!resource || !action) return false;
        return allowed.has(`${resource}:${action}`);
      },
    });
  }

  async function insertExisting(table: string, data: Record<string, unknown>): Promise<void> {
    const columns = await context.db(table).columnInfo();
    const filtered = Object.fromEntries(
      Object.entries(data).filter(([column]) => column in columns)
    );

    await context.db(table).insert(filtered);
  }

  async function seedTicket(input: {
    ticketNumber: string;
    title: string;
    enteredAt: string;
    closedAt?: string | null;
  }): Promise<string> {
    const ticketId = randomUUID();
    await insertExisting('tickets', {
      tenant: context.tenantId,
      ticket_id: ticketId,
      client_id: context.clientId,
      ticket_number: input.ticketNumber,
      title: input.title,
      entered_at: input.enteredAt,
      closed_at: input.closedAt ?? null,
      is_closed: Boolean(input.closedAt),
      updated_at: input.closedAt ?? input.enteredAt,
    });

    return ticketId;
  }

  async function seedInvoice(input: {
    invoiceNumber: string;
    createdAt: string;
    finalizedAt?: string | null;
    totalAmount?: number;
    status?: string;
  }): Promise<string> {
    const invoiceId = randomUUID();
    const totalAmount = input.totalAmount ?? 10000;
    await insertExisting('invoices', {
      tenant: context.tenantId,
      invoice_id: invoiceId,
      client_id: context.clientId,
      invoice_number: input.invoiceNumber,
      invoice_date: input.createdAt.slice(0, 10),
      due_date: input.createdAt.slice(0, 10),
      subtotal: totalAmount,
      tax: 0,
      total_amount: totalAmount,
      credit_applied: 0,
      status: input.status ?? 'draft',
      finalized_at: input.finalizedAt ?? null,
      currency_code: 'USD',
      is_manual: true,
      is_prepayment: false,
      tax_source: 'internal',
      created_at: input.createdAt,
      updated_at: input.finalizedAt ?? input.createdAt,
    });

    return invoiceId;
  }

  async function seedAsset(input: {
    name: string;
    serialNumber: string;
  }): Promise<string> {
    const assetColumns = await context.db('assets').columnInfo();
    const needsLegacyType = 'type_id' in assetColumns;
    const hasLegacyAssetTypes = await context.db.schema.hasTable('asset_types');
    const typeId = needsLegacyType ? randomUUID() : null;
    const assetId = randomUUID();

    if (typeId && hasLegacyAssetTypes) {
      await insertExisting('asset_types', {
        tenant: context.tenantId,
        type_id: typeId,
        type_name: `Timeline asset type ${typeId.slice(0, 8)}`,
        attributes_schema: {},
      });
    }

    await insertExisting('assets', {
      tenant: context.tenantId,
      asset_id: assetId,
      type_id: typeId,
      asset_type: 'network_device',
      client_id: context.clientId,
      asset_tag: `AT-${assetId.slice(0, 8)}`,
      serial_number: input.serialNumber,
      name: input.name,
      status: 'active',
      attributes: {},
    });

    return assetId;
  }

  async function seedDeliveredUnit(input: {
    productName: string;
    serialNumber: string;
    deliveredAt: string;
    withAsset?: boolean;
  }): Promise<{ unitId: string; assetId: string | null }> {
    const unitId = randomUUID();
    const serviceId = await createTestService(context, {
      service_name: input.productName,
      service_id: randomUUID(),
      default_rate: 25000,
    });
    const assetId = input.withAsset
      ? await seedAsset({ name: input.productName, serialNumber: input.serialNumber })
      : null;

    await insertExisting('stock_units', {
      tenant: context.tenantId,
      unit_id: unitId,
      service_id: serviceId,
      serial_number: input.serialNumber,
      status: 'delivered',
      client_id: context.clientId,
      asset_id: assetId,
      delivered_at: input.deliveredAt,
      received_at: input.deliveredAt,
      unit_cost: 12000,
      cost_currency: 'USD',
      created_at: input.deliveredAt,
      updated_at: input.deliveredAt,
    });

    return { unitId, assetId };
  }

  async function seedInteraction(input: {
    typeName: string;
    title: string;
    occurredAt: string;
  }): Promise<string> {
    const typeId = randomUUID();
    const interactionId = randomUUID();

    await insertExisting('interaction_types', {
      tenant: context.tenantId,
      type_id: typeId,
      type_name: input.typeName,
    });

    await insertExisting('interactions', {
      tenant: context.tenantId,
      interaction_id: interactionId,
      type_id: typeId,
      client_id: context.clientId,
      user_id: context.userId,
      title: input.title,
      interaction_date: input.occurredAt,
      start_time: input.occurredAt,
      end_time: input.occurredAt,
      duration: 0,
    });

    return interactionId;
  }

  async function seedQuoteActivity(input: {
    quoteNumber: string;
    activityType: string;
    description: string;
    createdAt: string;
  }): Promise<{ quoteId: string; activityId: string }> {
    const quoteId = randomUUID();
    const activityId = randomUUID();

    await insertExisting('quotes', {
      tenant: context.tenantId,
      quote_id: quoteId,
      quote_number: input.quoteNumber,
      client_id: context.clientId,
      title: `Quote ${input.quoteNumber}`,
      description: 'Timeline quote fixture',
      quote_date: input.createdAt.slice(0, 10),
      valid_until: input.createdAt.slice(0, 10),
      status: 'sent',
      subtotal: 10000,
      discount_total: 0,
      tax: 0,
      total_amount: 10000,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
      updated_by: context.userId,
      created_at: input.createdAt,
      updated_at: input.createdAt,
    });

    await insertExisting('quote_activities', {
      tenant: context.tenantId,
      activity_id: activityId,
      quote_id: quoteId,
      activity_type: input.activityType,
      description: input.description,
      performed_by: context.userId,
      metadata: {},
      created_at: input.createdAt,
    });

    return { quoteId, activityId };
  }

  async function seedSalesOrder(input: {
    soNumber: string;
    createdAt: string;
    status?: string;
  }): Promise<string> {
    const soId = randomUUID();
    await insertExisting('sales_orders', {
      tenant: context.tenantId,
      so_id: soId,
      so_number: input.soNumber,
      client_id: context.clientId,
      status: input.status ?? 'confirmed',
      order_date: input.createdAt,
      currency_code: 'USD',
      invoice_mode: 'manual',
      allocation_mode: 'soft',
      created_by: context.userId,
      created_at: input.createdAt,
      updated_at: input.createdAt,
    });

    return soId;
  }

  async function seedRma(input: {
    rmaReference: string;
    openedAt: string;
    closedAt?: string | null;
    status?: string;
  }): Promise<string> {
    const rmaId = randomUUID();
    const serviceId = await createTestService(context, {
      service_name: `RMA product ${rmaId.slice(0, 8)}`,
      service_id: randomUUID(),
      default_rate: 15000,
    });

    await insertExisting('rma_cases', {
      tenant: context.tenantId,
      rma_id: rmaId,
      rma_type: 'standard',
      service_id: serviceId,
      client_id: context.clientId,
      rma_reference: input.rmaReference,
      reason: 'Defective unit',
      status: input.status ?? (input.closedAt ? 'closed' : 'open'),
      opened_at: input.openedAt,
      closed_at: input.closedAt ?? null,
      created_by: context.userId,
      created_at: input.openedAt,
      updated_at: input.closedAt ?? input.openedAt,
    });

    return rmaId;
  }

  it('T005: merges timeline sources in strict descending order with correct refs', async () => {
    const ticketId = await seedTicket({
      ticketNumber: 'T005-001',
      title: 'Router offline',
      enteredAt: at(10),
    });
    const invoiceId = await seedInvoice({
      invoiceNumber: 'INV-T005',
      createdAt: at(20),
      finalizedAt: at(40),
      totalAmount: 12345,
      status: 'draft',
    });
    const unit = await seedDeliveredUnit({
      productName: 'Firewall 1000',
      serialNumber: 'FW-T005',
      deliveredAt: at(30),
      withAsset: true,
    });
    const interactionId = await seedInteraction({
      typeName: 'Meeting',
      title: 'Quarterly business review',
      occurredAt: at(50),
    });
    const quote = await seedQuoteActivity({
      quoteNumber: 'Q-T005',
      activityType: 'accepted',
      description: 'Quote accepted by client',
      createdAt: at(60),
    });

    const page = await listClientTimeline(context.clientId, { limit: 20 });

    expect(page.nextCursor).toBeNull();
    expect(page.events.map((event) => event.type)).toEqual([
      'quote_activity',
      'interaction',
      'invoice_finalized',
      'unit_delivered',
      'invoice_created',
      'ticket_opened',
    ]);
    expect(page.events.map((event) => event.occurredAt)).toEqual([
      at(60),
      at(50),
      at(40),
      at(30),
      at(20),
      at(10),
    ]);

    const byType = new Map(page.events.map((event) => [event.type, event]));

    expect(byType.get('ticket_opened')).toMatchObject({
      refType: 'ticket',
      refId: ticketId,
      refLabel: '#T005-001',
      summary: 'Router offline',
      status: 'open',
    });
    expect(byType.get('invoice_finalized')).toMatchObject({
      refType: 'invoice',
      refId: invoiceId,
      refLabel: 'INV-T005',
      amountCents: 12345,
      status: 'finalized',
    });
    expect(byType.get('unit_delivered')).toMatchObject({
      refType: 'stock_unit',
      refId: unit.unitId,
      refLabel: 'FW-T005',
      summary: 'Firewall 1000',
      linkedAssetId: unit.assetId,
    });
    expect(byType.get('interaction')).toMatchObject({
      refType: 'interaction',
      refId: interactionId,
      refLabel: 'Quarterly business review',
      summary: 'Meeting: Quarterly business review',
    });
    expect(byType.get('quote_activity')).toMatchObject({
      refType: 'quote',
      refId: quote.quoteId,
      refLabel: 'Q-T005',
      summary: 'Quote accepted by client',
      status: 'accepted',
    });
  });

  it('T006: paginates without overlap or gaps and respects type filters', async () => {
    for (let i = 0; i < 8; i += 1) {
      await seedTicket({
        ticketNumber: `T006-${i}`,
        title: `Pagination ticket ${i}`,
        enteredAt: at(10 + i),
      });
    }
    await seedInvoice({
      invoiceNumber: 'INV-T006',
      createdAt: at(30),
      finalizedAt: at(31),
      totalAmount: 5000,
      status: 'draft',
    });

    const full = await listClientTimeline(context.clientId, { limit: 50 });
    const page1 = await listClientTimeline(context.clientId, { limit: 5 });
    const page2 = await listClientTimeline(context.clientId, {
      limit: 5,
      cursor: page1.nextCursor,
    });

    expect(full.events).toHaveLength(10);
    expect(page1.events).toHaveLength(5);
    expect(page1.nextCursor).toEqual(expect.any(String));
    expect(page2.events).toHaveLength(5);
    expect(page2.nextCursor).toBeNull();

    const pagedIds = [...page1.events, ...page2.events].map((event) => event.id);
    expect(new Set(pagedIds).size).toBe(pagedIds.length);
    expect(pagedIds).toEqual(full.events.map((event) => event.id));

    const invoiceOnly = await listClientTimeline(context.clientId, {
      limit: 20,
      types: ['invoice_created', 'invoice_finalized'],
    });

    expect(invoiceOnly.events.map((event) => event.type)).toEqual([
      'invoice_finalized',
      'invoice_created',
    ] satisfies ClientTimelineEventType[]);
  });

  it('T007: hides billing and inventory sources by module permission while keeping tickets', async () => {
    await seedTicket({
      ticketNumber: 'T007-001',
      title: 'Permission-visible ticket',
      enteredAt: at(10),
    });
    await seedInvoice({
      invoiceNumber: 'INV-T007',
      createdAt: at(20),
      finalizedAt: at(21),
      totalAmount: 7000,
      status: 'draft',
    });
    await seedQuoteActivity({
      quoteNumber: 'Q-T007',
      activityType: 'sent',
      description: 'Quote sent to client',
      createdAt: at(30),
    });
    await seedDeliveredUnit({
      productName: 'Access point',
      serialNumber: 'AP-T007',
      deliveredAt: at(40),
    });
    await seedSalesOrder({
      soNumber: 'SO-T007',
      createdAt: at(50),
    });
    await seedRma({
      rmaReference: 'RMA-T007',
      openedAt: at(60),
      closedAt: at(61),
      status: 'closed',
    });

    setPermissions([
      ['client', 'read'],
      ['ticket', 'read'],
      ['inventory', 'read'],
    ]);
    const noBilling = await listClientTimeline(context.clientId, { limit: 50 });
    const noBillingTypes = new Set(noBilling.events.map((event) => event.type));
    expect(noBillingTypes).toContain('ticket_opened');
    expect(noBillingTypes).toContain('unit_delivered');
    expect(noBillingTypes).toContain('so_created');
    expect(noBillingTypes).toContain('rma_opened');
    expect(noBillingTypes).toContain('rma_closed');
    expect(noBillingTypes).not.toContain('invoice_created');
    expect(noBillingTypes).not.toContain('invoice_finalized');
    expect(noBillingTypes).not.toContain('quote_activity');

    setPermissions([
      ['client', 'read'],
      ['ticket', 'read'],
      ['billing', 'read'],
    ]);
    const noInventory = await listClientTimeline(context.clientId, { limit: 50 });
    const noInventoryTypes = new Set(noInventory.events.map((event) => event.type));
    expect(noInventoryTypes).toContain('ticket_opened');
    expect(noInventoryTypes).toContain('invoice_created');
    expect(noInventoryTypes).toContain('invoice_finalized');
    expect(noInventoryTypes).toContain('quote_activity');
    expect(noInventoryTypes).not.toContain('unit_delivered');
    expect(noInventoryTypes).not.toContain('so_created');
    expect(noInventoryTypes).not.toContain('rma_opened');
    expect(noInventoryTypes).not.toContain('rma_closed');
  });
});
