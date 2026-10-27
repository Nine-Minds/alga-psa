import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IFixedPriceCharge, ManualInvoiceSourceLink } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  connect: vi.fn(),
  facade: vi.fn(),
  generate: vi.fn(),
  tax: vi.fn(),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => action({ user_id: 'user-a' }, { tenant: 'tenant-a' }, ...args),
  hasPermission: mocks.permission,
}));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.connect, tenantDb: mocks.facade }));
vi.mock('@alga-psa/billing/actions/manualInvoiceActions', () => ({ generateManualInvoice: mocks.generate }));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({ generateInvoiceNumber: vi.fn() }));
vi.mock('@alga-psa/billing/services/taxService', () => ({ TaxService: class { calculateTax = mocks.tax; } }));
vi.mock('@alga-psa/billing/lib/authHelpers', () => ({
  getCurrentUserAsync: vi.fn(), hasPermissionAsync: vi.fn(), getSessionAsync: vi.fn(), getAnalyticsAsync: vi.fn(),
}));
vi.mock('@alga-psa/billing/lib/billing/billingProfileLookup', () => ({
  getClientDefaultBillingProfileId: vi.fn(async () => 'profile-a'),
}));

import { generateTicketInvoice, getTicketBillableItems } from '@alga-psa/billing/actions/ticketInvoiceActions';
import { persistInvoiceCharges, persistManualInvoiceCharges } from '@alga-psa/billing/services/invoiceService';
import { BillingEngine } from '@alga-psa/billing/lib/billing/billingEngine';

const version = '2026-10-27 12:00:00.123456+00';
const fee = {
  entry_id: 'fee-a', ticket_id: 'ticket-a', client_id: 'client-a', service_id: 'service-a',
  service_name: 'Setup', quantity: 2, rate: 2500, currency_code: 'USD',
  description: null, is_billed: false, source_updated_at: version, updated_at: version,
};
function query(row?: Record<string, unknown>, rows: Record<string, unknown>[] = []) {
  let requiredVersion: string | undefined;
  const builder = {
    where: vi.fn((...args: unknown[]) => {
      if (typeof args[0] === 'object' && args[0] && 'updated_at' in args[0]) {
        requiredVersion = String(args[0].updated_at);
      }
      return builder;
    }),
    whereIn: vi.fn(() => builder),
    whereNotNull: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    forUpdate: vi.fn(() => builder),
    forShare: vi.fn(() => builder),
    select: vi.fn(() => builder),
    first: vi.fn(async () => requiredVersion && requiredVersion !== row?.updated_at ? undefined : row),
    insert: vi.fn(async () => 1),
    update: vi.fn(async () => 1),
    then: (resolve: (value: Record<string, unknown>[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}
let tables: Record<string, ReturnType<typeof query>>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.connect.mockResolvedValue({ knex: { raw: vi.fn((sql: string) => sql) } });
  mocks.generate.mockResolvedValue({ success: true });
  mocks.tax.mockResolvedValue({ taxAmount: 250, taxRate: 5 });
  tables = {
    tickets: query({ ticket_id: 'ticket-a', client_id: 'client-a' }),
    clients: query({ default_currency_code: 'USD' }),
    'time_entries as te': query(undefined, []),
    'ticket_materials as tm': query(undefined, []),
    'ticket_fixed_fee_services as f': query(undefined, [{ ...fee }]),
    ticket_fixed_fee_services: query({ ...fee }),
    ticket_materials: query({
      ticket_material_id: 'material-a', ticket_id: 'ticket-a', client_id: 'client-a',
      service_id: 'service-a', quantity: 2, rate: 2500, currency_code: 'USD', updated_at: version,
    }),
    invoices: query({ ticket_id: 'ticket-a', client_id: 'client-a', is_manual: true, currency_code: 'USD' }),
    service_catalog: query({ service_id: 'service-a', service_name: 'Setup', billing_method: 'fixed', tax_rate_id: null }),
    invoice_charges: query(),
  };
  mocks.facade.mockImplementation(() => ({
    table: (name: string) => {
      if (!tables[name]) throw new Error(`Unexpected table ${name}`);
      return tables[name];
    },
    tenantJoin: vi.fn(),
  }));
});

describe('ticket fixed-fee quick invoice selection', () => {
  it('creates a fee-only invoice with catalog name fallback and an exact source version', async () => {
    await generateTicketInvoice({ ticketId: 'ticket-a', timeEntryIds: [], materialIds: [], fixedFeeIds: ['fee-a', 'fee-a'] });
    expect(mocks.generate).toHaveBeenCalledWith({
      clientId: 'client-a', ticket_id: 'ticket-a', currency_code: 'USD',
      items: [{
        service_id: 'service-a', quantity: 2, rate: 2500, description: 'Setup',
        source_link: { kind: 'ticket_fixed_fee', entryId: 'fee-a', updatedAt: version },
      }],
    });
    expect(tables['ticket_fixed_fee_services as f'].where).toHaveBeenCalledWith({
      'f.ticket_id': 'ticket-a', 'f.client_id': 'client-a', 'f.is_billed': false,
    });
  });

  it('lists same-currency fees and reports exclusions', async () => {
    tables['ticket_fixed_fee_services as f'] = query(undefined, [{ ...fee }, { ...fee, entry_id: 'fee-eur', currency_code: 'EUR' }]);
    expect(await getTicketBillableItems('ticket-a')).toMatchObject({
      fixedFeeItems: [{ id: 'fee-a', quantity: 2, rate: 2500, amount: 5000 }],
      excludedFixedFeeCount: 1,
    });
  });

  it('rejects foreign/missing/already-billed selections rather than generating a partial invoice', async () => {
    tables['ticket_fixed_fee_services as f'] = query(undefined, []);
    expect(await generateTicketInvoice({
      ticketId: 'ticket-a', timeEntryIds: [], materialIds: [], fixedFeeIds: ['fee-a'],
    })).toMatchObject({ success: false, code: 'SOURCE_ALREADY_BILLED' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('rejects currency mismatch', async () => {
    tables['ticket_fixed_fee_services as f'] = query(undefined, [{ ...fee, currency_code: 'EUR' }]);
    expect(await generateTicketInvoice({
      ticketId: 'ticket-a', timeEntryIds: [], materialIds: [], fixedFeeIds: ['fee-a'],
    })).toMatchObject({ success: false, code: 'SOURCE_CURRENCY_MISMATCH' });
  });

  it('requires billing create permission', async () => {
    mocks.permission.mockResolvedValue(false);
    expect(await generateTicketInvoice({
      ticketId: 'ticket-a', timeEntryIds: [], materialIds: [], fixedFeeIds: ['fee-a'],
    })).toMatchObject({ success: false, code: 'PERMISSION_DENIED' });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});

describe('manual invoice fixed-fee and edited material source lifecycle', () => {
  const persist = (source_link: ManualInvoiceSourceLink, overrides: Record<string, unknown> = {}) =>
    persistManualInvoiceCharges(
      {} as never, 'invoice-a',
      [{ service_id: 'service-a', quantity: 2, rate: 2500, description: 'Setup', source_link, ...overrides }],
      { client_id: 'client-a', region_code: null },
      { user: { id: 'user-a' } } as never, 'tenant-a',
    );
  const link: ManualInvoiceSourceLink = { kind: 'ticket_fixed_fee', entryId: 'fee-a', updatedAt: version };

  it('persists and atomically claims the fixed-fee entry through the existing manual pipeline', async () => {
    expect(await persist(link)).toBe(5000);
    expect(tables.invoice_charges.insert).toHaveBeenCalledWith(expect.objectContaining({
      service_id: 'service-a', quantity: 2, unit_price: 2500, net_amount: 5000, description: 'Setup',
    }));
    expect(tables.ticket_fixed_fee_services.update).toHaveBeenCalledWith(expect.objectContaining({
      is_billed: true, billed_invoice_id: 'invoice-a',
    }));
    expect(tables.ticket_fixed_fee_services.forUpdate).toHaveBeenCalled();
    expect(mocks.facade).toHaveBeenCalledWith({}, 'tenant-a');
  });

  describe('scheduled fixed-fee source claims', () => {
    const charge: IFixedPriceCharge = {
      type: 'fixed', serviceId: 'service-a', serviceName: 'Setup',
      quantity: 2, rate: 2500, total: 5000, unit_code: 'EA',
      ticket_fixed_fee_id: 'fee-a', ticket_fixed_fee_updated_at: version,
      is_taxable: true, tax_region: 'service-region', tax_amount: 250, tax_rate: 5,
    };
    const persist = () => persistInvoiceCharges(
      {} as never, 'invoice-a', [{ ...charge }],
      { client_id: 'client-a', tax_region: 'client-region' },
      { user: { id: 'user-a' } } as never, 'tenant-a',
    );

    it('uses the simple fixed charge path, preserves service tax region, and claims the exact snapshot', async () => {
      expect(await persist()).toBe(5000);
      expect(tables.invoice_charges.insert).toHaveBeenCalledWith(expect.objectContaining({
        quantity: 2, unit_price: 2500, net_amount: 5000, tax_region: 'service-region', is_manual: false,
      }));
      expect(tables.ticket_fixed_fee_services.where).toHaveBeenCalledWith({
        entry_id: 'fee-a', client_id: 'client-a', is_billed: false, service_id: 'service-a',
        quantity: 2, rate: 2500, currency_code: 'USD', updated_at: version,
      });

      expect(tables.ticket_fixed_fee_services.update).toHaveBeenCalledWith(expect.objectContaining({
        is_billed: true, billed_invoice_id: 'invoice-a',
      }));
    });

    it('aborts persistence when an edit or another invoice changed the source', async () => {
      tables.ticket_fixed_fee_services.update.mockResolvedValue(0);
      await expect(persist()).rejects.toThrow('changed or was already billed');
    });
  });

  it('rejects stale microsecond versions, including description-only edits', async () => {
    await expect(persist({ ...link, updatedAt: '2026-10-27 12:00:00.123455+00' })).rejects.toMatchObject({
      code: 'SOURCE_NOT_ELIGIBLE',
    });
    expect(tables.invoice_charges.insert).not.toHaveBeenCalled();
  });

  it('rejects stale edited material versions before persisting a charge', async () => {
    await expect(persist({
      kind: 'ticket_material', materialId: 'material-a', updatedAt: '2026-10-27 12:00:00.123455+00',
    })).rejects.toMatchObject({ code: 'SOURCE_NOT_ELIGIBLE' });
    expect(tables.invoice_charges.insert).not.toHaveBeenCalled();
  });

  it.each([
    { ticket_id: 'other-ticket' }, { client_id: 'other-client' }, { quantity: 3 }, { rate: 3000 },
  ])('rejects changed or foreign fixed-fee source %j', async (changes) => {
    tables.ticket_fixed_fee_services = query({ ...fee, ...changes });
    await expect(persist(link)).rejects.toMatchObject({ code: 'SOURCE_NOT_ELIGIBLE' });
    expect(tables.invoice_charges.insert).not.toHaveBeenCalled();
  });

  it('rejects billed source and zero-row concurrent claims', async () => {
    tables.ticket_fixed_fee_services = query({ ...fee, is_billed: true });
    await expect(persist(link)).rejects.toMatchObject({ code: 'SOURCE_ALREADY_BILLED' });
    tables.ticket_fixed_fee_services = query({ ...fee });
    tables.ticket_fixed_fee_services.update.mockResolvedValue(0);
    await expect(persist(link)).rejects.toMatchObject({ code: 'SOURCE_ALREADY_BILLED' });
  });
});

describe('scheduled ticket fixed-fee calculation', () => {
  const calculate = async () => {
    const engine = BillingEngine.forTransaction({ raw: (sql: string) => sql } as never, 'tenant-a');
    Reflect.set(engine, 'getTaxInfoFromService', vi.fn(async () => ({ taxRegion: 'service-region', isTaxable: true })));
    const method = Reflect.get(engine, 'calculateTicketFixedFeeCharges');
    if (typeof method !== 'function') throw new Error('Ticket fixed-fee calculator is missing');
    return method.call(engine, 'client-a', { startDate: '2026-10-01', endDate: '2026-11-01' }, 'USD');
  };

  it('calculates quantity times catalog price, taxes, and exact provenance within an end-exclusive window', async () => {
    expect(await calculate()).toEqual([expect.objectContaining({
      type: 'fixed', serviceId: 'service-a', serviceName: 'Setup',
      quantity: 2, rate: 2500, total: 5000, tax_amount: 250, tax_rate: 5,
      ticket_fixed_fee_id: 'fee-a', ticket_fixed_fee_updated_at: version,
    })]);
    const where = tables['ticket_fixed_fee_services as f'].where;
    expect(where).toHaveBeenCalledWith({ 'f.client_id': 'client-a', 'f.is_billed': false, 'f.currency_code': 'USD' });
    expect(where).toHaveBeenCalledWith('f.created_at', '>=', '2026-10-01');
    expect(where).toHaveBeenCalledWith('f.created_at', '<', '2026-11-01');
    expect(mocks.tax).toHaveBeenCalledWith('client-a', 5000, '2026-11-01', 'service-region', true, 'USD');
  });

  it('fails visibly for invalid stored amounts instead of silently invoicing a fallback', async () => {
    tables['ticket_fixed_fee_services as f'] = query(undefined, [{ ...fee, quantity: -1 }]);
    await expect(calculate()).rejects.toThrow('invalid quantity or rate');
  });
});
