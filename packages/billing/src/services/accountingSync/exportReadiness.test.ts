import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const resolveServiceMappingMock = vi.hoisted(() => vi.fn());

vi.mock('./accountingSyncSettings', () => ({
  getAccountingSyncSettings: vi.fn(async () => ({
    autoSyncEnabled: true,
    autoSyncStartDate: null,
    autoProvisionCustomers: false,
    depositAccountRef: null,
    defaultClassRef: null,
    defaultDepartmentRef: null,
    defaultRealm: null
  })),
  resolveDefaultRealm: vi.fn(async () => 'realm-1')
}));

vi.mock('../accountingMappingResolver', () => ({
  AccountingMappingResolver: vi.fn().mockImplementation(function () {
    return { resolveServiceMapping: resolveServiceMappingMock };
  })
}));

import { assertInvoiceExportReady, InvoiceExportReadinessError } from './exportReadiness';
import { getAccountingSyncSettings, resolveDefaultRealm } from './accountingSyncSettings';

const TENANT = 't1';
const INVOICE = 'inv-1';

interface KnexFixture {
  invoice?: any;
  charges?: any[];
  services?: any[];
  /** item_ids that have invoice_charge_details children (consolidated fixed parents). */
  detailBackedChargeIds?: string[];
}

/** Multi-table fake knex covering invoices, invoice_charges, details, and service_catalog. */
function makeKnex(fixture: KnexFixture): any {
  const knex: any = vi.fn((table: string) => {
    if (table === 'invoices') {
      return { where: () => ({ select: () => ({ first: async () => fixture.invoice }) }) };
    }
    if (table === 'invoice_charges') {
      return { where: () => ({ select: async () => fixture.charges ?? [] }) };
    }
    if (table === 'invoice_charge_details') {
      return {
        whereIn: () => ({
          andWhere: () => ({
            select: async () => (fixture.detailBackedChargeIds ?? []).map((id) => ({ item_id: id }))
          })
        })
      };
    }
    if (table === 'service_catalog') {
      return { whereIn: () => ({ andWhere: () => ({ select: async () => fixture.services ?? [] }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return knex;
}

const standardInvoice = { invoice_type: 'standard', is_prepayment: false, invoice_date: '2026-06-20' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('EDITION', 'ee');
  vi.mocked(getAccountingSyncSettings).mockResolvedValue({
    autoSyncEnabled: true,
    autoSyncStartDate: null,
    autoProvisionCustomers: false,
    depositAccountRef: null,
    defaultClassRef: null,
    defaultDepartmentRef: null,
    defaultRealm: null
  });
  vi.mocked(resolveDefaultRealm).mockResolvedValue('realm-1');
  resolveServiceMappingMock.mockResolvedValue({ external_entity_id: 'item-1', metadata: {} });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('assertInvoiceExportReady', () => {
  it('passes when every line has a mapped service', async () => {
    const knex = makeKnex({
      invoice: standardInvoice,
      charges: [{ item_id: 'c1', service_id: 'svc-1', description: 'Managed services' }]
    });

    await expect(assertInvoiceExportReady(knex, TENANT, INVOICE)).resolves.toBeUndefined();
  });

  it('blocks finalize when a line has no service, naming the line', async () => {
    const knex = makeKnex({
      invoice: standardInvoice,
      charges: [
        { item_id: 'c1', service_id: 'svc-1', description: 'Managed services' },
        { item_id: 'c2', service_id: null, description: 'Freight for handset shipment' }
      ]
    });

    await expect(assertInvoiceExportReady(knex, TENANT, INVOICE)).rejects.toThrow(
      /no service assigned.*Freight for handset shipment/s
    );
  });

  it('blocks finalize when a service has no QBO item mapping, naming the service', async () => {
    resolveServiceMappingMock.mockResolvedValue(null);
    const knex = makeKnex({
      invoice: standardInvoice,
      charges: [{ item_id: 'c1', service_id: 'svc-1', description: 'Managed services' }],
      services: [{ service_id: 'svc-1', service_name: 'PBX Maintenance' }]
    });

    await expect(assertInvoiceExportReady(knex, TENANT, INVOICE)).rejects.toThrow(
      /no QuickBooks item mapping.*PBX Maintenance/s
    );
    await expect(assertInvoiceExportReady(knex, TENANT, INVOICE)).rejects.toBeInstanceOf(
      InvoiceExportReadinessError
    );
  });

  it('does not flag consolidated fixed-plan parent charges (their services live in detail rows)', async () => {
    const knex = makeKnex({
      invoice: standardInvoice,
      charges: [{ item_id: 'parent-1', service_id: null, description: 'Fixed Plan: Monthly Support' }],
      detailBackedChargeIds: ['parent-1']
    });

    await expect(assertInvoiceExportReady(knex, TENANT, INVOICE)).resolves.toBeUndefined();
  });

  it('does not gate invoices that will not export: auto-sync off', async () => {
    vi.mocked(getAccountingSyncSettings).mockResolvedValue({
      autoSyncEnabled: false,
      autoSyncStartDate: null,
      autoProvisionCustomers: false,
      depositAccountRef: null,
      defaultClassRef: null,
      defaultDepartmentRef: null,
      defaultRealm: null
    });
    const knex = makeKnex({
      invoice: standardInvoice,
      charges: [{ item_id: 'c1', service_id: null, description: 'anything' }]
    });

    await expect(assertInvoiceExportReady(knex, TENANT, INVOICE)).resolves.toBeUndefined();
  });

  it('does not gate prepayment invoices (they never export)', async () => {
    const knex = makeKnex({
      invoice: { invoice_type: 'standard', is_prepayment: true, invoice_date: '2026-06-20' },
      charges: [{ item_id: 'c1', service_id: null, description: 'deposit' }]
    });

    await expect(assertInvoiceExportReady(knex, TENANT, INVOICE)).resolves.toBeUndefined();
  });

  it('does not gate invoices dated before the go-live cutoff', async () => {
    vi.mocked(getAccountingSyncSettings).mockResolvedValue({
      autoSyncEnabled: true,
      autoSyncStartDate: '2026-06-01',
      autoProvisionCustomers: false,
      depositAccountRef: null,
      defaultClassRef: null,
      defaultDepartmentRef: null,
      defaultRealm: null
    });
    const knex = makeKnex({
      invoice: { invoice_type: 'standard', is_prepayment: false, invoice_date: '2024-03-15' },
      charges: [{ item_id: 'c1', service_id: null, description: 'historical line' }]
    });

    await expect(assertInvoiceExportReady(knex, TENANT, INVOICE)).resolves.toBeUndefined();
  });

  it('does not gate when no realm is connected', async () => {
    vi.mocked(resolveDefaultRealm).mockResolvedValue(null);
    const knex = makeKnex({
      invoice: standardInvoice,
      charges: [{ item_id: 'c1', service_id: null, description: 'anything' }]
    });

    await expect(assertInvoiceExportReady(knex, TENANT, INVOICE)).resolves.toBeUndefined();
  });

  it('fails OPEN on infrastructure errors — a broken check must not brick finalize', async () => {
    vi.mocked(getAccountingSyncSettings).mockRejectedValue(new Error('settings table unavailable'));
    const knex = makeKnex({});

    await expect(assertInvoiceExportReady(knex, TENANT, INVOICE)).resolves.toBeUndefined();
  });
});
