import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from './_dbTestUtils';
import { ManualInvoiceError } from '../errors/manualInvoiceErrors';

// Real-database coverage for the quick-invoice-a-ticket source claims.
//
// persistManualInvoiceCharges must move the invoice line and the claimed source
// record (time_entries.invoiced / ticket_materials.is_billed) together inside the
// caller's transaction. A stale or foreign selection updates zero rows and must
// abort the whole invoice rather than half-billing or double-billing. The claim
// is what a concurrent submission races against, so these assertions run against
// real Postgres with the exact tenant predicate the service uses.

// invoiceService pulls the invoice-number generator and auth helpers for its
// other exports; none participate in charge persistence.
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  generateInvoiceNumber: vi.fn(),
}));
vi.mock('../services/taxService', () => ({
  TaxService: class TaxService {},
}));
vi.mock('../lib/authHelpers', () => ({
  getCurrentUserAsync: vi.fn(),
  hasPermissionAsync: vi.fn(),
  getSessionAsync: vi.fn(),
  getAnalyticsAsync: vi.fn(),
}));

const { persistManualInvoiceCharges } = await import('../services/invoiceService');

let db: Knex;
let tenant: string;
let clientId: string;
let serviceId: string;
let userId: string;
let ticketId: string;

const OTHER_TENANT = uuidv4();

interface SeededContext {
  tenant: string;
  clientId: string;
  serviceId: string;
  userId: string;
  ticketId: string;
}

async function insertTimeEntry(params: {
  ownerTenant?: string;
  ownerUserId?: string;
  ticket?: string;
  service?: string | null;
  invoiced?: boolean;
  approvalStatus?: string;
} = {}): Promise<string> {
  const entryId = uuidv4();
  await db('time_entries').insert({
    tenant: params.ownerTenant ?? tenant,
    entry_id: entryId,
    user_id: params.ownerUserId ?? userId,
    work_item_id: params.ticket ?? ticketId,
    work_item_type: 'ticket',
    service_id: params.service === undefined ? serviceId : params.service,
    billable_duration: 120,
    approval_status: params.approvalStatus ?? 'APPROVED',
    invoiced: params.invoiced ?? false,
    start_time: '2026-09-01T09:00:00.000Z',
    end_time: '2026-09-01T11:00:00.000Z',
    work_date: '2026-09-01',
    work_timezone: 'UTC',
  });
  return entryId;
}

async function insertTicketMaterial(params: {
  ticket?: string;
  isBilled?: boolean;
  currency?: string;
  client?: string;
} = {}): Promise<string> {
  const materialId = uuidv4();
  await db('ticket_materials').insert({
    tenant,
    ticket_material_id: materialId,
    ticket_id: params.ticket ?? ticketId,
    client_id: params.client ?? clientId,
    service_id: serviceId,
    quantity: 2,
    rate: 2500,
    currency_code: params.currency ?? 'USD',
    description: 'Replacement widget',
    is_billed: params.isBilled ?? false,
  });
  return materialId;
}

async function runPersist(params: {
  invoiceId: string;
  items: Parameters<typeof persistManualInvoiceCharges>[2];
  invoice?: Record<string, unknown>;
  afterPersist?: () => Promise<void>;
  beforePersist?: () => Promise<void>;
}): Promise<void> {
  await db.transaction(async (trx) => {
    await trx('invoices').insert({
      tenant, invoice_id: params.invoiceId,
      invoice_number: `TICKET-CLAIM-${params.invoiceId}`,
      invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
      total_amount: 0, status: 'draft', client_id: clientId,
      currency_code: 'USD', is_manual: true, ticket_id: ticketId,
      ...params.invoice,
    });
    await params.beforePersist?.();
    await persistManualInvoiceCharges(
      trx,
      params.invoiceId,
      params.items,
      { client_id: clientId, region_code: null, default_currency_code: 'USD' },
      { user: { id: userId } } as never,
      tenant,
    );
    await params.afterPersist?.();
  });
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();

  const seedTenant = await db('tenants').first('tenant');
  tenant = seedTenant.tenant;

  const ticket = await db('tickets').where({ tenant }).whereNotNull('client_id').first();
  const client = await db('clients').where({ tenant, client_id: ticket.client_id }).first();
  const service = await db('service_catalog').where({ tenant }).first();
  const user = await db('users').where({ tenant }).first();
  await db('service_catalog').where({ tenant, service_id: service.service_id }).update({ default_rate: 12000 });

  const ctx: SeededContext = {
    tenant,
    clientId: client.client_id,
    serviceId: service.service_id,
    userId: user.user_id,
    ticketId: ticket.ticket_id,
  };
  clientId = ctx.clientId;
  serviceId = ctx.serviceId;
  userId = ctx.userId;
  ticketId = ctx.ticketId;

  // Billing-profile resolution terminates on the client default (F002); the dev
  // seed predates that invariant, so provision it for the seeded client.
  const existingProfile = await db('client_billing_profiles')
    .where({ tenant, client_id: clientId, is_default: true })
    .first('billing_profile_id');
  if (!existingProfile) {
    await db('client_billing_profiles').insert({
      tenant,
      billing_profile_id: uuidv4(),
      client_id: clientId,
      name: 'Default',
      is_default: true,
      is_system_managed_default: true,
    });
  }

  // A second tenant proves the claim's tenant predicate: a source row owned by
  // another tenant must never be claimed by this invoice.
  await db('tenants').insert({
    tenant: OTHER_TENANT,
    client_name: 'Other Tenant',
    email: `other-${OTHER_TENANT.slice(0, 8)}@example.com`,
  });
});

afterAll(async () => {
  // The harness recreates test_database per file run; every row inserted here is
  // uniquely keyed, so drop the connection without a bespoke teardown cascade.
  await db?.destroy().catch(() => undefined);
});

describe('persistManualInvoiceCharges ticket source claims (DB-backed)', () => {
  it('claims an unbilled time entry and links the work-item snapshot', async () => {
    const entryId = await insertTimeEntry();
    const invoiceId = uuidv4();

    await runPersist({
      invoiceId,
      items: [
        {
          service_id: serviceId,
          quantity: 2,
          rate: 12000,
          description: 'Remote Support',
          source_link: { kind: 'time_entry', entryId },
        },
      ],
    });

    const entry = await db('time_entries').where({ tenant, entry_id: entryId }).first('invoiced');
    expect(entry.invoiced).toBe(true);

    const charge = await db('invoice_charges')
      .where({ tenant, invoice_id: invoiceId })
      .first('item_id', 'net_amount');
    expect(Number(charge?.net_amount)).toBe(24000);

    const link = await db('invoice_time_entries')
      .where({ tenant, entry_id: entryId })
      .first('invoice_id', 'item_id', 'work_item_snapshot');
    expect(link).toMatchObject({ invoice_id: invoiceId, item_id: charge?.item_id });
    expect(link?.work_item_snapshot).toMatchObject({
      workItemType: 'ticket',
      workItemId: ticketId,
      billedMinutes: 120,
      netAmount: 24000,
    });
  });

  it('claims only the selected time entries, leaving unselected ones unbilled', async () => {
    const selectedEntryId = await insertTimeEntry();
    const unselectedEntryId = await insertTimeEntry();
    const invoiceId = uuidv4();

    await runPersist({
      invoiceId,
      items: [
        {
          service_id: serviceId,
          quantity: 2,
          rate: 12000,
          description: 'Remote Support',
          source_link: { kind: 'time_entry', entryId: selectedEntryId },
        },
      ],
    });

    const selected = await db('time_entries')
      .where({ tenant, entry_id: selectedEntryId })
      .first('invoiced');
    const unselected = await db('time_entries')
      .where({ tenant, entry_id: unselectedEntryId })
      .first('invoiced');
    expect(selected.invoiced).toBe(true);
    expect(unselected.invoiced).toBe(false);

    const charges = await db('invoice_charges').where({ tenant, invoice_id: invoiceId });
    expect(charges).toHaveLength(1);
  });

  it('claims an unbilled ticket material and records the billing backlink', async () => {
    const materialId = await insertTicketMaterial();
    const invoiceId = uuidv4();

    await runPersist({
      invoiceId,
      items: [
        {
          service_id: serviceId,
          quantity: 2,
          rate: 2500,
          description: 'Replacement widget',
          source_link: { kind: 'ticket_material', materialId },
        },
      ],
    });

    const material = await db('ticket_materials')
      .where({ tenant, ticket_material_id: materialId })
      .first('is_billed', 'billed_invoice_id', 'billed_at');
    expect(material?.is_billed).toBe(true);
    expect(material?.billed_invoice_id).toBe(invoiceId);
    expect(material?.billed_at).toBeTruthy();
  });

  it('aborts and rolls back the whole invoice when a time entry is already invoiced', async () => {
    const entryId = await insertTimeEntry({ invoiced: true });
    const invoiceId = uuidv4();

    await expect(
      runPersist({
        invoiceId,
        items: [
          {
            service_id: serviceId,
            quantity: 2,
            rate: 12000,
            description: 'Remote Support',
            source_link: { kind: 'time_entry', entryId },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_ALREADY_BILLED' });

    // Invoice creation and all related writes must roll back.
    const charges = await db('invoice_charges').where({ tenant, invoice_id: invoiceId });
    expect(charges).toHaveLength(0);
    expect(await db('invoices').where({ tenant, invoice_id: invoiceId }).first()).toBeUndefined();
    const links = await db('invoice_time_entries').where({ tenant, entry_id: entryId });
    expect(links).toHaveLength(0);
    const entry = await db('time_entries').where({ tenant, entry_id: entryId }).first('invoiced');
    expect(entry.invoiced).toBe(true);
  });

  it('aborts and rolls back when a ticket material is already billed', async () => {
    const materialId = await insertTicketMaterial({ isBilled: true });
    const invoiceId = uuidv4();

    await expect(
      runPersist({
        invoiceId,
        items: [
          {
            service_id: serviceId,
            quantity: 2,
            rate: 2500,
            description: 'Replacement widget',
            source_link: { kind: 'ticket_material', materialId },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_ALREADY_BILLED' });

    const charges = await db('invoice_charges').where({ tenant, invoice_id: invoiceId });
    expect(charges).toHaveLength(0);
    expect(await db('invoices').where({ tenant, invoice_id: invoiceId }).first()).toBeUndefined();
  });

  it('does not claim a time entry owned by another tenant', async () => {
    const otherUser = uuidv4();
    await db('users').insert({
      tenant: OTHER_TENANT,
      user_id: otherUser,
      username: `other-${otherUser.slice(0, 8)}`,
      hashed_password: 'x',
      email: `other-${otherUser.slice(0, 8)}@example.com`,
    });
    const foreignEntryId = await insertTimeEntry({
      ownerTenant: OTHER_TENANT,
      ownerUserId: otherUser,
      ticket: uuidv4(),
      service: null,
    });
    const invoiceId = uuidv4();

    await expect(
      runPersist({
        invoiceId,
        items: [
          {
            service_id: serviceId,
            quantity: 2,
            rate: 12000,
            description: 'Remote Support',
            source_link: { kind: 'time_entry', entryId: foreignEntryId },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ManualInvoiceError);

    const foreignEntry = await db('time_entries')
      .where({ tenant: OTHER_TENANT, entry_id: foreignEntryId })
      .first('invoiced');
    expect(foreignEntry.invoiced).toBe(false);
    const charges = await db('invoice_charges').where({ tenant, invoice_id: invoiceId });
    expect(charges).toHaveLength(0);
    expect(await db('invoices').where({ tenant, invoice_id: invoiceId }).first()).toBeUndefined();
  });

  const timeItem = (entryId: string) => ({
    service_id: serviceId, quantity: 2, rate: 12000, description: 'Remote Support',
    source_link: { kind: 'time_entry' as const, entryId },
  });
  const materialItem = (materialId: string) => ({
    service_id: serviceId, quantity: 2, rate: 2500, description: 'Replacement widget',
    source_link: { kind: 'ticket_material' as const, materialId },
  });

  async function expectNoInvoice(invoiceId: string) {
    for (const table of ['invoices', 'invoice_charges', 'invoice_time_entries']) {
      expect(await db(table).where({ tenant, invoice_id: invoiceId })).toHaveLength(0);
    }
  }

  it.each(['missing ticket', 'wrong client', 'prepayment', 'nonmanual'])('rejects direct source links on a %s invoice', async (scenario) => {
    const entryId = await insertTimeEntry();
    const invoiceId = uuidv4();
    const otherClient = await db('clients').where({ tenant }).whereNot('client_id', clientId).first();
    const overrides = {
      'missing ticket': { ticket_id: null },
      'wrong client': { client_id: otherClient.client_id },
      prepayment: { is_prepayment: true },
      nonmanual: { is_manual: false },
    };
    await expect(runPersist({ invoiceId, items: [timeItem(entryId)], invoice: overrides[scenario as keyof typeof overrides] }))
      .rejects.toMatchObject({ code: 'SOURCE_NOT_ELIGIBLE' });
    await expectNoInvoice(invoiceId);
    expect((await db('time_entries').where({ tenant, entry_id: entryId }).first()).invoiced).toBe(false);
  });

  it.each(['wrong ticket', 'unapproved', 'wrong rate', 'duplicate'])('rejects %s time submitted directly to persistence', async (scenario) => {
    const entryId = await insertTimeEntry({
      ...(scenario === 'wrong ticket' ? { ticket: uuidv4() } : {}),
      ...(scenario === 'unapproved' ? { approvalStatus: 'DRAFT' } : {}),
    });
    const invoiceId = uuidv4();
    const item = timeItem(entryId);
    if (scenario === 'wrong rate') item.rate = 1;
    await expect(runPersist({ invoiceId, items: scenario === 'duplicate' ? [item, item] : [item] }))
      .rejects.toMatchObject({ code: 'SOURCE_NOT_ELIGIBLE' });
    await expectNoInvoice(invoiceId);
    expect((await db('time_entries').where({ tenant, entry_id: entryId }).first()).invoiced).toBe(false);
  });

  it.each(['currency', 'client', 'ticket'])('rejects product %s mismatches at persistence', async (scenario) => {
    const otherClient = await db('clients').where({ tenant }).whereNot('client_id', clientId).first();
    const otherTicket = await db('tickets').where({ tenant }).whereNot('ticket_id', ticketId).first();
    const materialId = await insertTicketMaterial({
      ...(scenario === 'currency' ? { currency: 'EUR' } : {}),
      ...(scenario === 'client' ? { client: otherClient.client_id } : {}),
      ...(scenario === 'ticket' ? { ticket: otherTicket.ticket_id } : {}),
    });
    const invoiceId = uuidv4();
    await expect(runPersist({ invoiceId, items: [materialItem(materialId)] }))
      .rejects.toMatchObject({ code: scenario === 'currency' ? 'SOURCE_CURRENCY_MISMATCH' : 'SOURCE_NOT_ELIGIBLE' });
    await expectNoInvoice(invoiceId);
    expect((await db('ticket_materials').where({ tenant, ticket_material_id: materialId }).first()).is_billed).toBe(false);
  });

  it('rolls back invoice, charges, snapshots and both claims after a later failure', async () => {
    const entryId = await insertTimeEntry();
    const materialId = await insertTicketMaterial();
    const invoiceId = uuidv4();
    await expect(runPersist({
      invoiceId, items: [timeItem(entryId), materialItem(materialId)],
      afterPersist: async () => { throw new Error('subsequent invoice step failed'); },
    })).rejects.toThrow('subsequent invoice step failed');
    await expectNoInvoice(invoiceId);
    expect((await db('time_entries').where({ tenant, entry_id: entryId }).first()).invoiced).toBe(false);
    expect(await db('ticket_materials').where({ tenant, ticket_material_id: materialId }).first())
      .toMatchObject({ is_billed: false, billed_invoice_id: null, billed_at: null });
  });

  it('serializes concurrent overlapping selections and rolls back the losing invoice', async () => {
    const entryId = await insertTimeEntry();
    const materialId = await insertTicketMaterial();
    const firstId = uuidv4();
    const secondId = uuidv4();
    let release!: () => void;
    let claimed!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { claimed = resolve; });
    const first = runPersist({
      invoiceId: firstId, items: [timeItem(entryId), materialItem(materialId)],
      afterPersist: async () => { claimed(); await held; },
    });
    // The first transaction owns both source locks before the second starts.
    await Promise.race([ready, first]);
    let secondStarted!: () => void;
    const secondReady = new Promise<void>(resolve => { secondStarted = resolve; });
    const second = runPersist({
      invoiceId: secondId, items: [materialItem(materialId), timeItem(entryId)],
      beforePersist: async () => { secondStarted(); },
    });
    const resultsPromise = Promise.allSettled([first, second]);
    try {
      await Promise.race([secondReady, second]);
    } finally {
      release();
    }
    const results = await resultsPromise;
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'SOURCE_ALREADY_BILLED' } });
    await expectNoInvoice(secondId);
    expect(await db('invoice_charges').where({ tenant, invoice_id: firstId })).toHaveLength(2);
    expect(await db('invoice_time_entries').where({ tenant, entry_id: entryId })).toHaveLength(1);
    expect(await db('ticket_materials').where({ tenant, ticket_material_id: materialId }).first())
      .toMatchObject({ is_billed: true, billed_invoice_id: firstId });
  });

});
