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

async function insertInvoice(clientId: string): Promise<string> {
  const invoiceId = uuidv4();
  await db('invoices').insert({
    tenant,
    invoice_id: invoiceId,
    invoice_number: `TICKET-CLAIM-${invoiceId.slice(0, 8)}`,
    invoice_date: new Date().toISOString(),
    due_date: new Date().toISOString(),
    total_amount: 0,
    status: 'draft',
    client_id: clientId,
    currency_code: 'USD',
    is_manual: true,
  });
  return invoiceId;
}

async function insertTimeEntry(params: {
  ownerTenant?: string;
  ownerUserId?: string;
  ticket?: string;
  service?: string | null;
  invoiced?: boolean;
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
    approval_status: 'APPROVED',
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
} = {}): Promise<string> {
  const materialId = uuidv4();
  await db('ticket_materials').insert({
    tenant,
    ticket_material_id: materialId,
    ticket_id: params.ticket ?? ticketId,
    client_id: clientId,
    service_id: serviceId,
    quantity: 2,
    rate: 2500,
    currency_code: 'USD',
    description: 'Replacement widget',
    is_billed: params.isBilled ?? false,
  });
  return materialId;
}

async function runPersist(params: {
  invoiceId: string;
  items: Parameters<typeof persistManualInvoiceCharges>[2];
}): Promise<void> {
  await db.transaction(async (trx) => {
    await persistManualInvoiceCharges(
      trx,
      params.invoiceId,
      params.items,
      { client_id: clientId, region_code: null, default_currency_code: 'USD' },
      { user: { id: userId } } as never,
      tenant,
    );
  });
}

const snapshot = (entryId: string) => ({
  version: 2 as const,
  rateKind: 'uniform' as const,
  uniformRate: 12000,
  workItemType: 'ticket' as const,
  workItemId: ticketId,
  ticketNumber: 'T-1001',
  title: 'Printer jam',
  description: null,
  entryDate: '2026-09-01T09:00:00.000Z',
  billedMinutes: 120,
  rate: 12000,
  netAmount: 24000,
  serviceId,
  serviceName: 'Remote Support',
  entryId,
});

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();

  const seedTenant = await db('tenants').first('tenant');
  tenant = seedTenant.tenant;

  const client = await db('clients').where({ tenant }).first();
  const service = await db('service_catalog').where({ tenant }).first();
  const user = await db('users').where({ tenant }).first();
  const ticket = await db('tickets').where({ tenant }).first();

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
  await db.destroy().catch(() => undefined);
});

describe('persistManualInvoiceCharges ticket source claims (DB-backed)', () => {
  it('claims an unbilled time entry and links the work-item snapshot', async () => {
    const entryId = await insertTimeEntry();
    const invoiceId = await insertInvoice(clientId);

    await runPersist({
      invoiceId,
      items: [
        {
          service_id: serviceId,
          quantity: 2,
          rate: 12000,
          description: 'Remote Support',
          source_link: { kind: 'time_entry', entryId, snapshot: snapshot(entryId) },
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
    const invoiceId = await insertInvoice(clientId);

    await runPersist({
      invoiceId,
      items: [
        {
          service_id: serviceId,
          quantity: 2,
          rate: 12000,
          description: 'Remote Support',
          source_link: { kind: 'time_entry', entryId: selectedEntryId, snapshot: snapshot(selectedEntryId) },
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
    const invoiceId = await insertInvoice(clientId);

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
    const invoiceId = await insertInvoice(clientId);

    await expect(
      runPersist({
        invoiceId,
        items: [
          {
            service_id: serviceId,
            quantity: 2,
            rate: 12000,
            description: 'Remote Support',
            source_link: { kind: 'time_entry', entryId, snapshot: snapshot(entryId) },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_ALREADY_BILLED' });

    // The charge insert that preceded the failed claim must not survive.
    const charges = await db('invoice_charges').where({ tenant, invoice_id: invoiceId });
    expect(charges).toHaveLength(0);
    const links = await db('invoice_time_entries').where({ tenant, entry_id: entryId });
    expect(links).toHaveLength(0);
    const entry = await db('time_entries').where({ tenant, entry_id: entryId }).first('invoiced');
    expect(entry.invoiced).toBe(true);
  });

  it('aborts and rolls back when a ticket material is already billed', async () => {
    const materialId = await insertTicketMaterial({ isBilled: true });
    const invoiceId = await insertInvoice(clientId);

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
    const invoiceId = await insertInvoice(clientId);

    await expect(
      runPersist({
        invoiceId,
        items: [
          {
            service_id: serviceId,
            quantity: 2,
            rate: 12000,
            description: 'Remote Support',
            source_link: { kind: 'time_entry', entryId: foreignEntryId, snapshot: snapshot(foreignEntryId) },
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
  });
});
