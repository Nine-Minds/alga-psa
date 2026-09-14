import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

/**
 * DB-backed valid-selection -> realm-scoped mapping lookup.
 *
 * A manual export created with an explicit, connected target must persist that
 * exact adapter/target pair and its mappings must resolve against that realm
 * only. This runs the real selector, the real export service/repository and the
 * real mapping resolver/repository; only the stored connection loaders and the
 * DB handle are pinned.
 */

const connectionsState = vi.hoisted(() => ({
  xero: {
    'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a', tenantName: 'Org A' },
    'conn-b': { connectionId: 'conn-b', xeroTenantId: 'org-b', tenantName: 'Org B' }
  } as Record<string, { connectionId: string; xeroTenantId: string; tenantName: string }>,
  qbo: { 'qbo-realm-a': { realmId: 'qbo-realm-a' } } as Record<string, unknown>
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/integrations/lib/xero/xeroClientService')>()),
  getStoredXeroConnections: async () => connectionsState.xero,
  getXeroDefaultSelection: async () => ({ status: 'resolved', connectionId: 'conn-a' })
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/integrations/lib/qbo/qboClientService')>()),
  getStoredQboCredentialsMap: async () => connectionsState.qbo,
  getDefaultQboRealmId: async () => 'qbo-realm-a'
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: unknown) => fn }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));

import * as dbModule from '@alga-psa/db';
import { AccountingExportInvoiceSelector } from '../accountingExportInvoiceSelector';
import { AccountingMappingResolver } from '../accountingMappingResolver';
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

async function seedInvoice(): Promise<{ invoiceId: string; chargeId: string; serviceId: string }> {
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

  return { invoiceId, chargeId, serviceId };
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
  await db('accounting_export_lines').where({ tenant: tenantA }).del();
  await db('accounting_export_batches').where({ tenant: tenantA }).del();
  await db('tenant_external_entity_mappings').where({ tenant: tenantA }).del();
  await db('invoice_charges').where({ tenant: tenantA }).del();
  await db('invoices').where({ tenant: tenantA }).del();
  await db('service_catalog').where({ tenant: tenantA }).del();
  await db('clients').where({ tenant: tenantA }).del();
  await db('tenants').where({ tenant: tenantA }).del();
  await db.destroy().catch(() => undefined);
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await db('accounting_export_lines').where({ tenant: tenantA }).del();
  await db('accounting_export_batches').where({ tenant: tenantA }).del();
  await db('tenant_external_entity_mappings').where({ tenant: tenantA }).del();
  await db('invoice_charges').where({ tenant: tenantA }).del();
  await db('invoices').where({ tenant: tenantA }).del();
  await db('service_catalog').where({ tenant: tenantA }).del();
  await db('clients').where({ tenant: tenantA }).del();
  connectionsState.xero = {
    'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a', tenantName: 'Org A' },
    'conn-b': { connectionId: 'conn-b', xeroTenantId: 'org-b', tenantName: 'Org B' }
  };
  connectionsState.qbo = { 'qbo-realm-a': { realmId: 'qbo-realm-a' } };
});

describe('manual export connection selection resolves the selected realm\'s mappings (DB-backed)', () => {
  it('persists the selected Xero connection and resolves only that connection\'s mappings', async () => {
    const { invoiceId, serviceId } = await seedInvoice();
    const selector = new AccountingExportInvoiceSelector(db, tenantA);

    const { batch } = await selector.createBatchFromFilters({
      adapterType: 'xero',
      targetRealm: 'conn-a',
      filters: { invoiceIds: [invoiceId] }
    });

    expect(batch.adapter_type).toBe('xero');
    expect(batch.target_realm).toBe('conn-a');

    // Simulate the delivery-write of the mapping under the selected realm, plus
    // a service mapping, then prove the realm-scoped lookups used by delivery
    // resolve the selected connection and never fall through to another one.
    await new KnexInvoiceMappingRepository(db).upsertInvoiceMapping({
      tenantId: tenantA,
      adapterType: 'xero',
      invoiceId,
      externalInvoiceId: 'XERO-INV-CONN-A',
      targetRealm: 'conn-a'
    });
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

    const invoiceRepo = new KnexInvoiceMappingRepository(db);
    await expect(
      invoiceRepo.findInvoiceMapping({ tenantId: tenantA, adapterType: 'xero', invoiceId, targetRealm: 'conn-a' })
    ).resolves.toMatchObject({ externalInvoiceId: 'XERO-INV-CONN-A' });
    await expect(
      invoiceRepo.findInvoiceMapping({ tenantId: tenantA, adapterType: 'xero', invoiceId, targetRealm: 'conn-b' })
    ).resolves.toBeNull();

    const resolver = new AccountingMappingResolver(db, undefined, tenantA);
    await expect(
      resolver.resolveServiceMapping({ adapterType: 'xero', serviceId, targetRealm: 'conn-a' })
    ).resolves.toMatchObject({ external_entity_id: 'REVENUE-CONN-A' });
    await expect(
      resolver.resolveServiceMapping({ adapterType: 'xero', serviceId, targetRealm: 'conn-b' })
    ).resolves.toBeNull();
  });

  it('persists the selected QBO realm and resolves that realm\'s mappings only', async () => {
    const { invoiceId } = await seedInvoice();
    const selector = new AccountingExportInvoiceSelector(db, tenantA);

    const { batch } = await selector.createBatchFromFilters({
      adapterType: 'quickbooks_online',
      targetRealm: 'qbo-realm-a',
      filters: { invoiceIds: [invoiceId] }
    });

    expect(batch.adapter_type).toBe('quickbooks_online');
    expect(batch.target_realm).toBe('qbo-realm-a');

    await new KnexInvoiceMappingRepository(db).upsertInvoiceMapping({
      tenantId: tenantA,
      adapterType: 'quickbooks_online',
      invoiceId,
      externalInvoiceId: 'QBO-INV-REALM-A',
      targetRealm: 'qbo-realm-a'
    });

    const invoiceRepo = new KnexInvoiceMappingRepository(db);
    await expect(
      invoiceRepo.findInvoiceMapping({
        tenantId: tenantA,
        adapterType: 'quickbooks_online',
        invoiceId,
        targetRealm: 'qbo-realm-a'
      })
    ).resolves.toMatchObject({ externalInvoiceId: 'QBO-INV-REALM-A' });
    await expect(
      invoiceRepo.findInvoiceMapping({
        tenantId: tenantA,
        adapterType: 'quickbooks_online',
        invoiceId,
        targetRealm: 'qbo-realm-missing'
      })
    ).resolves.toBeNull();
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
