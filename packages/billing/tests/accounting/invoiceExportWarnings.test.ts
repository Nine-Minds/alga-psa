import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  allowed: true,
  qbo: {} as Record<string, unknown>, xero: {} as Record<string, unknown>,
  generated: [] as any[], details: [] as any[], files: [] as any[],
  service: vi.fn(), discount: vi.fn(),
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({}, { tenant: 'tenant' }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => state.allowed }));
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({ getStoredQboCredentialsMap: async () => state.qbo }));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({ getStoredXeroConnections: async () => state.xero }));
vi.mock('../../src/services/accountingMappingResolver', () => ({ AccountingMappingResolver: class {
  resolveServiceMapping = state.service;
  resolveDiscountMapping = state.discount;
} }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: (name: string) => {
    const query = {
      where: () => query, whereIn: () => query, whereNull: () => query,
      first: async () => ({ invoice_id: 'invoice' }),
      distinct: async () => state.files,
      select: async () => name === 'invoice_charges' ? state.generated : state.details,
    };
    return query;
  } }),
}));
import { getInvoiceAdjustmentExportWarnings } from '../../src/actions/invoiceExportWarnings';

beforeEach(() => {
  state.allowed = true;
  state.qbo = {}; state.xero = {}; state.generated = []; state.details = []; state.files = [];
  state.service.mockReset().mockResolvedValue(null);
  state.discount.mockReset().mockResolvedValue(null);
});

describe('adjustment editor export warnings', () => {
  it('warns for an unmapped charge and negative-rate credit in the active accounting company', async () => {
    state.qbo = { realm: {} };
    const result = await getInvoiceAdjustmentExportWarnings('invoice', [
      { service_id: 'misc', description: 'One-time support', rate: 100 },
      { description: 'Credit', rate: -100 },
    ]);
    expect(result).toEqual([
      { code: 'service', description: 'One-time support', adapter: 'quickbooks_online' },
      { code: 'discount', description: 'Credit', adapter: 'quickbooks_online' },
    ]);
    expect(state.service).toHaveBeenCalledWith({ adapterType: 'quickbooks_online', targetRealm: 'realm', serviceId: 'misc' });
    expect(state.discount).toHaveBeenCalledWith({ adapterType: 'quickbooks_online', targetRealm: 'realm' });
  });
  it('checks generated allocations and automatic discounts, retaining legacy unassigned warnings', async () => {
    state.files = [{ integration_type: 'quickbooks_desktop' }];
    state.generated = [
      { item_id: 'parent', description: 'Fixed package' },
      { item_id: 'legacy', description: 'Legacy charge' },
      { item_id: 'discount', is_discount: true, description: 'Contract discount' },
    ];
    state.details = [{ item_id: 'parent', service_id: 'service' }];
    state.service.mockResolvedValue({ external_entity_id: 'income' });
    const warnings = await getInvoiceAdjustmentExportWarnings('invoice', []);
    expect(warnings.map(row => row.description)).toEqual(['Legacy charge', 'Contract discount']);
    expect(state.service).toHaveBeenCalledWith({ adapterType: 'quickbooks_desktop', targetRealm: null, serviceId: 'service' });
  });
  it('does not warn when mappings exist, or when no integration is configured', async () => {
    expect(await getInvoiceAdjustmentExportWarnings('invoice', [{ service_id: 'misc' }])).toEqual([]);
    state.xero = { company: {} };
    state.service.mockResolvedValue({ external_entity_id: '200' });
    state.discount.mockResolvedValue({ external_entity_id: '201' });
    expect(await getInvoiceAdjustmentExportWarnings('invoice', [{ service_id: 'misc' }, { is_discount: true }])).toEqual([]);
  });
  it('requires invoice read permission before exposing mapping state', async () => {
    state.allowed = false;
    await expect(getInvoiceAdjustmentExportWarnings('invoice', [])).rejects.toThrow('Permission denied');
    expect(state.service).not.toHaveBeenCalled();
  });
});
