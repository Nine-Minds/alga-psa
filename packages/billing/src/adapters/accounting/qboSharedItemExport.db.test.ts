import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../actions/_dbTestUtils';
import { QuickBooksOnlineAdapter } from './quickBooksOnlineAdapter';
import type { AccountingExportAdapterContext } from '@alga-psa/types';

/**
 * Many-to-one QBO item mapping: several Alga services may map to ONE QBO item.
 * The forward export is service -> item only, so two services sharing an item
 * must yield two independent lines carrying the same ItemRef, and unlinking
 * one service must not disturb the other.
 */

const qboCreate = vi.hoisted(() => vi.fn());
const qboUpdate = vi.hoisted(() => vi.fn());
const qboRead = vi.hoisted(() => vi.fn());

const refs = vi.hoisted(() => ({ knex: null as any, tenant: '' as string }));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: refs.knex, tenant: refs.tenant })),
    withTransaction: vi.fn(async (knex: Knex, callback: (trx: Knex) => Promise<unknown>) => callback(knex)),
  };
});

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: {
    create: vi.fn(async () => ({ create: qboCreate, update: qboUpdate, read: qboRead })),
  },
  getDefaultQboRealmId: vi.fn(async () => REALM_FOR_MOCK),
  getQboCompanyCountry: vi.fn(async () => 'US'),
}));
vi.mock('@alga-psa/integrations/lib/qbo/qboTaxSettings', () => ({
  isQboAutomatedSalesTaxEnabled: async () => false,
}));

const REALM_FOR_MOCK = 'realm-shared-item';
const REALM = REALM_FOR_MOCK;
const SHARED_ITEM = 'ITEM-SHARED';

const tenantId = uuidv4();
const clientId = uuidv4();
const invoiceId = uuidv4();
const serviceA = uuidv4();
const serviceB = uuidv4();
const chargeA = uuidv4();
const chargeB = uuidv4();
const serviceTypeId = uuidv4();

let db: Knex;

function mapping(type: string, algaId: string, externalId: string, overrides: Record<string, unknown> = {}) {
  return {
    tenant: tenantId,
    integration_type: 'quickbooks_online',
    alga_entity_type: type,
    alga_entity_id: algaId,
    external_entity_id: externalId,
    external_realm_id: REALM,
    sync_status: 'manual_link',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...overrides,
  };
}

function makeContext(): AccountingExportAdapterContext {
  return {
    batch: {
      tenant: tenantId,
      batch_id: uuidv4(),
      adapter_type: 'quickbooks_online',
      target_realm: REALM,
      export_type: 'invoice',
      status: 'pending',
      queued_at: new Date().toISOString(),
      created_at: '2026-09-01',
      updated_at: new Date().toISOString(),
    },
    lines: [chargeA, chargeB].map((chargeId, index) => ({
      tenant: tenantId,
      line_id: uuidv4(),
      batch_id: 'b',
      document_id: invoiceId,
      document_line_id: chargeId,
      client_id: clientId,
      amount_cents: index === 0 ? 10000 : 25000,
      currency_code: 'USD',
      payload: { service_period_source: 'financial_document_fallback' },
    })),
    taxDelegationMode: 'internal',
  } as unknown as AccountingExportAdapterContext;
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  refs.knex = db;
  refs.tenant = tenantId;

  await db('tenants').insert({
    tenant: tenantId,
    client_name: 'Shared Item Export Test',
    email: `shared-item-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('clients').insert({ tenant: tenantId, client_id: clientId, client_name: 'Shared Item Client' });
  await db('service_types').insert({ id: serviceTypeId, tenant: tenantId, name: 'Shared Item Type' });
  for (const [id, name] of [[serviceA, 'Shared Service A'], [serviceB, 'Shared Service B']]) {
    await db('service_catalog').insert({
      tenant: tenantId,
      service_id: id,
      service_name: name,
      billing_method: 'fixed',
      default_rate: 5000,
      custom_service_type_id: serviceTypeId,
    });
  }
  await db('invoices').insert({
    tenant: tenantId, invoice_id: invoiceId, client_id: clientId,
    invoice_number: `INV-${invoiceId}`, invoice_date: '2026-09-01',
    due_date: '2026-09-30', status: 'sent', total_amount: 35000, subtotal: 35000, tax: 0,
    finalized_at: db.fn.now(),
  });
  const chargeBase = {
    tenant: tenantId, invoice_id: invoiceId, tax_amount: 0, tax_rate: 0,
    is_manual: false, is_discount: false, is_taxable: false,
  };
  await db('invoice_charges').insert([
    { ...chargeBase, item_id: chargeA, service_id: serviceA, description: 'Alpha work', quantity: 1, unit_price: 10000, net_amount: 10000, total_price: 10000 },
    { ...chargeBase, item_id: chargeB, service_id: serviceB, description: 'Beta work', quantity: 5, unit_price: 5000, net_amount: 25000, total_price: 25000 },
  ]);
});

beforeEach(async () => {
  qboCreate.mockReset();
  qboUpdate.mockReset();
  qboRead.mockReset();
  await db('tenant_external_entity_mappings').where({ tenant: tenantId }).del();
  await db('tenant_external_entity_mappings').insert([
    mapping('client', clientId, 'CUSTOMER-1'),
    mapping('service', serviceA, SHARED_ITEM),
    mapping('service', serviceB, SHARED_ITEM),
  ]);
});

afterAll(async () => {
  await db('tenant_external_entity_mappings').where({ tenant: tenantId }).del();
  await db('invoice_charges').where({ tenant: tenantId }).del();
  await db('invoices').where({ tenant: tenantId }).del();
  await db('service_catalog').where({ tenant: tenantId }).del();
  await db('service_types').where({ tenant: tenantId }).del();
  await db('clients').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
  await db.destroy().catch(() => undefined);
});

describe('QBO export with two services mapped to one shared item', () => {
  it('emits two independent lines with the same ItemRef, then delivers and persists the invoice mapping', async () => {
    const adapter = new QuickBooksOnlineAdapter();
    const context = makeContext();
    const transformed = await adapter.transform(context);

    expect(transformed.documents).toHaveLength(1);
    const invoice = (transformed.documents[0].payload as any).invoice;
    const lines = invoice.Line;
    expect(lines).toHaveLength(2);
    expect(lines.map((l: any) => l.SalesItemLineDetail.ItemRef.value)).toEqual([SHARED_ITEM, SHARED_ITEM]);
    expect(lines.map((l: any) => l.Amount)).toEqual([100, 250]);
    expect(lines.map((l: any) => l.Description)).toEqual(['Alpha work', 'Beta work']);
    expect((transformed.documents[0].payload as any).chargeIds).toEqual([chargeA, chargeB]);

    qboCreate.mockImplementation(async (_entity: string, payload: any) => ({
      ...payload,
      Id: 'qbo-inv-shared',
      SyncToken: '0',
      TotalAmt: 350,
      DocNumber: 'INV-SHARED',
      Line: payload.Line.map((line: any, i: number) => ({ ...line, Id: `qbo-line-${i}` })),
    }));

    const delivery = await adapter.deliver(transformed, context);
    expect(delivery.failedDocuments).toBeUndefined();
    expect(delivery.deliveredLines).toHaveLength(2);
    expect(qboCreate).toHaveBeenCalledTimes(1);
    const sent = qboCreate.mock.calls[0][1];
    expect(sent.Line.map((l: any) => l.SalesItemLineDetail.ItemRef.value)).toEqual([SHARED_ITEM, SHARED_ITEM]);

    const invoiceMapping = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantId, alga_entity_type: 'invoice', alga_entity_id: invoiceId })
      .whereNull('deleted_at')
      .first();
    expect(invoiceMapping).toBeDefined();
    expect(invoiceMapping.external_entity_id).toBe('qbo-inv-shared');
    expect(invoiceMapping.external_realm_id).toBe(REALM);
  });

  it('unlinking one service leaves the other resolving to the shared item and fails the unlinked one as unmapped', async () => {
    const now = new Date().toISOString();
    await db('tenant_external_entity_mappings')
      .where({ tenant: tenantId, alga_entity_type: 'service', alga_entity_id: serviceB })
      .update({ deleted_at: now, sync_status: 'unlinked', updated_at: now });

    // Both charges: the unlinked service has no live mapping -> mapping-missing error.
    await expect(new QuickBooksOnlineAdapter().transform(makeContext())).rejects.toThrow(
      `QuickBooks adapter: no mapping for service ${serviceB}`
    );

    // Only the still-linked service's line: resolves to the shared item.
    const onlyA = makeContext();
    onlyA.lines = onlyA.lines.filter((l: any) => l.document_line_id === chargeA);
    const transformed = await new QuickBooksOnlineAdapter().transform(onlyA);
    const lines = (transformed.documents[0].payload as any).invoice.Line;
    expect(lines).toHaveLength(1);
    expect(lines[0].SalesItemLineDetail.ItemRef.value).toBe(SHARED_ITEM);
    expect(lines[0].Description).toBe('Alpha work');

    // The tombstone is intact and the surviving mapping is untouched.
    const rows = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantId, alga_entity_type: 'service' })
      .orderBy('alga_entity_id');
    const byService = new Map(rows.map((r: any) => [r.alga_entity_id, r]));
    expect(byService.get(serviceB).deleted_at).not.toBeNull();
    expect(byService.get(serviceB).sync_status).toBe('unlinked');
    expect(byService.get(serviceA).deleted_at).toBeNull();
    expect(byService.get(serviceA).external_entity_id).toBe(SHARED_ITEM);
  });
});
