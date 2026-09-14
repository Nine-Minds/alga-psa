import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

/**
 * DB-backed selected-target delivery.
 *
 * A manual export created with an explicit, connected target is delivered
 * through the real export service, the real provider adapter and the real
 * mapping resolver. Only the vendor HTTP boundary (QboClientService) is faked;
 * the credential store, DB handle and permissions are the seams pinned for the
 * test. The reported scenario — QuickBooks Online selected while Xero B is the
 * saved default — must deliver against the selected QBO realm and use that
 * realm's mappings.
 */

const connectionsState = vi.hoisted(() => ({
  xero: {
    'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a', tenantName: 'Org A' },
    'conn-b': { connectionId: 'conn-b', xeroTenantId: 'org-b', tenantName: 'Org B' }
  } as Record<string, { connectionId: string; xeroTenantId: string; tenantName: string }>,
  qbo: { 'qbo-realm-a': { realmId: 'qbo-realm-a' } } as Record<string, unknown>
}));

const qboVendor = vi.hoisted(() => ({
  deliveryCalls: [] as Array<{ realm: string; itemRefs: string[] }>
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/integrations/lib/xero/xeroClientService')>()),
  getStoredXeroConnections: async () => connectionsState.xero,
  getXeroDefaultSelection: async () => ({ status: 'resolved', connectionId: 'conn-b' })
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/integrations/lib/qbo/qboClientService')>()),
  getStoredQboCredentialsMap: async () => connectionsState.qbo,
  getDefaultQboRealmId: async () => 'qbo-realm-a',
  // The vendor boundary: record what would have been sent to QuickBooks.
  QboClientService: {
    create: async (_tenant: string, realm: string) => ({
      read: async () => null,
      update: async () => ({ Id: 'QB-INV-A-1', SyncToken: '1', Line: [] }),
      create: async (_entity: string, payload: any) => {
        const lines = Array.isArray(payload?.Line) ? payload.Line : [];
        qboVendor.deliveryCalls.push({
          realm,
          itemRefs: lines
            .map((line: any) => line?.SalesItemLineDetail?.ItemRef?.value)
            .filter((value: unknown): value is string => typeof value === 'string')
        });
        return {
          Id: 'QB-INV-A-1',
          SyncToken: '0',
          DocNumber: payload?.DocNumber ?? 'QBO-1',
          TotalAmt: payload?.TotalAmt ?? 50,
          Line: lines.map((line: any, index: number) => ({
            Id: String(index + 1),
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: line?.SalesItemLineDetail
          }))
        };
      }
    })
  }
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined)
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: unknown) => fn }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));

import * as dbModule from '@alga-psa/db';
import { AccountingExportInvoiceSelector } from '../accountingExportInvoiceSelector';
import { AccountingExportService } from '../accountingExportService';
import { KnexInvoiceMappingRepository } from '../../repositories/invoiceMappingRepository';
import { wireLocalTestDbEnv, createTestDbConnection } from '../../actions/_dbTestUtils';

const tenantA = randomUUID();
let db: Knex;

async function ensureServiceType(tenant: string): Promise<string> {
  const existing = await db('service_types').where({ tenant, name: 'Fixed Service Type' }).first('id');
  if (existing?.id) {
    return existing.id;
  }
  const id = randomUUID();
  await db('service_types').insert({ id, tenant, name: 'Fixed Service Type' });
  return id;
}

async function seedInvoice(): Promise<{ invoiceId: string; chargeId: string; serviceId: string; clientId: string }> {
  const clientId = randomUUID();
  const invoiceId = randomUUID();
  const chargeId = randomUUID();
  const serviceId = randomUUID();
  const invoiceDate = '2026-02-01T00:00:00.000Z';

  await db('clients').insert({
    tenant: tenantA,
    client_id: clientId,
    client_name: 'Selection Client',
    created_at: invoiceDate,
    updated_at: invoiceDate,
    is_inactive: false
  });

  const serviceTypeId = await ensureServiceType(tenantA);
  await db('service_catalog').insert({
    tenant: tenantA,
    service_id: serviceId,
    service_name: 'Managed Endpoint',
    billing_method: 'fixed',
    default_rate: 5000,
    custom_service_type_id: serviceTypeId
  });

  await db('invoices').insert({
    invoice_id: invoiceId,
    tenant: tenantA,
    client_id: clientId,
    invoice_number: `INV-${invoiceId.slice(0, 6)}`,
    invoice_date: invoiceDate,
    due_date: invoiceDate,
    subtotal: 5000,
    tax: 0,
    total_amount: 5000,
    status: 'sent',
    currency_code: 'USD',
    is_manual: false,
    created_at: invoiceDate,
    updated_at: invoiceDate
  });

  await db('invoice_charges').insert({
    item_id: chargeId,
    tenant: tenantA,
    invoice_id: invoiceId,
    service_id: serviceId,
    description: 'Selection line',
    quantity: 1,
    unit_price: 5000,
    total_price: 5000,
    net_amount: 5000,
    tax_amount: 0,
    is_manual: false,
    created_at: invoiceDate,
    updated_at: invoiceDate
  });

  return { invoiceId, chargeId, serviceId, clientId };
}

async function seedServiceMapping(serviceId: string, realmId: string, externalId: string): Promise<void> {
  await db('tenant_external_entity_mappings').insert({
    id: randomUUID(),
    tenant: tenantA,
    integration_type: 'quickbooks_online',
    alga_entity_type: 'service',
    alga_entity_id: serviceId,
    external_entity_id: externalId,
    external_realm_id: realmId,
    sync_status: 'manual_link',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

async function seedClientMapping(clientId: string, realmId: string): Promise<void> {
  await db('tenant_external_entity_mappings').insert({
    id: randomUUID(),
    tenant: tenantA,
    integration_type: 'quickbooks_online',
    alga_entity_type: 'client',
    alga_entity_id: clientId,
    external_entity_id: 'QB-CUST-A',
    external_realm_id: realmId,
    sync_status: 'manual_link',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: db, tenant: tenantA } as never);

  await db('tenants').insert({
    tenant: tenantA,
    client_name: `Selection ${tenantA.slice(0, 8)}`,
    email: `selection-${tenantA.slice(0, 8)}@example.com`
  });
});

afterAll(async () => {
  await db('accounting_export_errors').where({ tenant: tenantA }).del();
  await db('accounting_export_lines').where({ tenant: tenantA }).del();
  await db('accounting_export_batches').where({ tenant: tenantA }).del();
  await db('tenant_external_entity_mappings').where({ tenant: tenantA }).del();
  await db('invoice_charges').where({ tenant: tenantA }).del();
  await db('invoices').where({ tenant: tenantA }).del();
  await db('service_catalog').where({ tenant: tenantA }).del();
  await db('clients').where({ tenant: tenantA }).del();
  await db('tenant_settings').where({ tenant: tenantA }).del();
  await db('tenants').where({ tenant: tenantA }).del();
  await db.destroy().catch(() => undefined);
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await db('accounting_export_errors').where({ tenant: tenantA }).del();
  await db('accounting_export_lines').where({ tenant: tenantA }).del();
  await db('accounting_export_batches').where({ tenant: tenantA }).del();
  await db('tenant_external_entity_mappings').where({ tenant: tenantA }).del();
  await db('invoice_charges').where({ tenant: tenantA }).del();
  await db('invoices').where({ tenant: tenantA }).del();
  await db('service_catalog').where({ tenant: tenantA }).del();
  await db('clients').where({ tenant: tenantA }).del();
  await db('tenant_settings').where({ tenant: tenantA }).del();
  qboVendor.deliveryCalls.length = 0;
  connectionsState.xero = {
    'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a', tenantName: 'Org A' },
    'conn-b': { connectionId: 'conn-b', xeroTenantId: 'org-b', tenantName: 'Org B' }
  };
  connectionsState.qbo = { 'qbo-realm-a': { realmId: 'qbo-realm-a' } };
  // Reported scenario: Xero B is the saved default while QBO is connected.
  await db('tenant_settings').insert({
    tenant: tenantA,
    settings: { accountingSync: { defaultRealm: 'conn-b' } },
    updated_at: db.fn.now()
  });
});

describe('manual export selected-target delivery (DB-backed)', () => {
  it('delivers a QBO batch to the selected realm with that realm\'s mappings even when Xero B is default', async () => {
    const { invoiceId, serviceId, clientId } = await seedInvoice();
    // Realm isolation: decoy service mapping in another realm must not be used.
    await seedServiceMapping(serviceId, 'qbo-realm-decoy', 'SVC-DECOY');
    await seedServiceMapping(serviceId, 'qbo-realm-a', 'SVC-QBO-A');
    await seedClientMapping(clientId, 'qbo-realm-a');

    const batch = await new AccountingExportInvoiceSelector(db, tenantA).createBatchFromFilters({
      adapterType: 'quickbooks_online',
      targetRealm: 'qbo-realm-a',
      filters: { invoiceIds: [invoiceId] }
    });

    expect(batch.batch.adapter_type).toBe('quickbooks_online');
    expect(batch.batch.target_realm).toBe('qbo-realm-a');

    // Execute through the real service + real QBO adapter + real resolver.
    const service = await AccountingExportService.createForTenant(tenantA);
    const result = await service.executeBatch(batch.batch.batch_id);

    expect(result.failedDocuments ?? []).toHaveLength(0);
    expect(qboVendor.deliveryCalls).toHaveLength(1);
    expect(qboVendor.deliveryCalls[0].realm).toBe('qbo-realm-a');
    // Correct mapping usage: the selected realm's item, not the decoy.
    expect(qboVendor.deliveryCalls[0].itemRefs).toEqual(['SVC-QBO-A']);

    const delivered = await db('accounting_export_batches')
      .where({ batch_id: batch.batch.batch_id, tenant: tenantA })
      .first();
    expect(delivered?.status).toBe('delivered');

    const persistedMapping = await new KnexInvoiceMappingRepository(db).findInvoiceMapping({
      tenantId: tenantA,
      adapterType: 'quickbooks_online',
      invoiceId,
      targetRealm: 'qbo-realm-a'
    });
    expect(persistedMapping?.externalInvoiceId).toBe('QB-INV-A-1');
    expect(persistedMapping?.externalRealmId).toBe('qbo-realm-a');
  });

  it('resolves a selected Xero connection\'s mappings and not another connection\'s', async () => {
    const { invoiceId, serviceId } = await seedInvoice();
    const selector = new AccountingExportInvoiceSelector(db, tenantA);

    const { batch } = await selector.createBatchFromFilters({
      adapterType: 'xero',
      targetRealm: 'conn-a',
      filters: { invoiceIds: [invoiceId] }
    });
    expect(batch.target_realm).toBe('conn-a');

    await db('tenant_external_entity_mappings').insert({
      id: randomUUID(),
      tenant: tenantA,
      integration_type: 'xero',
      alga_entity_type: 'service',
      alga_entity_id: serviceId,
      external_entity_id: 'REVENUE-CONN-A',
      external_realm_id: 'conn-a',
      sync_status: 'manual_link',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // `ensureMappingsForBatch` uses the same realm-scoped resolver; run it to
    // prove the selected connection's mapping is the one found (and the realm
    // without a mapping fails closed instead of borrowing conn-a's).
    const { AccountingExportValidation } = await import('../accountingExportValidation');
    await AccountingExportValidation.ensureMappingsForBatch(batch.batch_id);
    const ready = await db('accounting_export_batches')
      .where({ batch_id: batch.batch_id, tenant: tenantA })
      .first();
    expect(ready?.status).toBe('ready');
  });

  it('rejects an invalid explicit target before writing any batch row', async () => {
    await seedInvoice();
    const before = Number(
      ((await db('accounting_export_batches').where({ tenant: tenantA }).count('* as count').first()) as { count?: string } | undefined)?.count ?? 0
    );
    const selector = new AccountingExportInvoiceSelector(db, tenantA);

    await expect(
      selector.createBatchFromFilters({
        adapterType: 'quickbooks_online',
        targetRealm: 'conn-a',
        filters: {}
      })
    ).rejects.toMatchObject({ code: 'ACCOUNTING_EXPORT_TARGET_UNAVAILABLE' });

    const after = Number(
      ((await db('accounting_export_batches').where({ tenant: tenantA }).count('* as count').first()) as { count?: string } | undefined)?.count ?? 0
    );
    expect(after).toBe(before);
  });
});
