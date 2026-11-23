import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';

// createHourBlockPurchaseInvoiceInternal stamps invoice_date: an explicit
// invoiceDate is used as given; otherwise tenant-local today from the real
// resolveTenantToday (reads tenant_settings through the fake trx below).

const state = vi.hoisted(() => ({
  settings: undefined as Record<string, unknown> | undefined,
  insertedInvoices: [] as Array<Record<string, any>>,
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => fn, getSession: vi.fn() }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('../src/actions/invoiceGeneration', () => ({ generateInvoiceNumber: vi.fn() }));
vi.mock('../src/actions/billingAndTax', () => ({ getDueDate: vi.fn() }));
vi.mock('../src/actions/taxSourceActions', () => ({ getInitialInvoiceTaxSource: vi.fn() }));
vi.mock('../src/services/taxService', () => ({ TaxService: class {} }));
vi.mock('../src/services/invoiceService', () => ({
  persistManualInvoiceCharges: vi.fn(async () => undefined),
  calculateAndDistributeTax: vi.fn(async () => undefined),
  updateInvoiceTotalsAndRecordTransaction: vi.fn(async () => undefined),
}));
vi.mock('../src/services/pendingHourBlockService', () => ({
  createPendingHourBlockForInvoiceCharge: vi.fn(async () => ({ blockId: 'block-1' })),
}));

function makeTrx() {
  return ((table: string) => {
    const qb: any = {
      where: () => qb,
      select: () => qb,
      first: async () => {
        if (table === 'tenant_settings') return state.settings ? { settings: state.settings } : undefined;
        if (table === 'invoice_charges') return { item_id: 'charge-1' };
        return undefined;
      },
      insert: async (row: Record<string, any>) => {
        if (table === 'invoices') state.insertedInvoices.push(row);
      },
    };
    return qb;
  }) as any;
}

import { createHourBlockPurchaseInvoiceInternal } from '../src/actions/hourBlockActions';

const baseInput = () => ({
  trx: makeTrx(),
  tenant: 'tenant-1',
  clientId: 'client-1',
  serviceId: 'service-1',
  hours: 10,
  hourlyRate: 100,
  client: { client_id: 'client-1' },
  service: { service_name: 'Support' },
  currencyCode: 'USD',
  dueDate: '2026-11-18',
  taxSource: 'internal',
  invoiceNumber: 'INV-1',
  createdBy: 'user-1',
});

describe('createHourBlockPurchaseInvoiceInternal invoice_date', () => {
  beforeEach(() => {
    state.settings = undefined;
    state.insertedInvoices.length = 0;
    vi.spyOn(Temporal.Now, 'instant').mockReturnValue(Temporal.Instant.from('2026-10-18T22:00:00Z'));
  });
  afterEach(() => vi.restoreAllMocks());

  it('stamps an explicit invoiceDate as given', async () => {
    state.settings = { timezone: 'Pacific/Honolulu' };
    await createHourBlockPurchaseInvoiceInternal({ ...baseInput(), invoiceDate: '2026-10-19' });
    expect(state.insertedInvoices[0].invoice_date).toBe('2026-10-19');
  });

  it('without invoiceDate, a Sydney tenant at 2026-10-18T22:00Z is dated the 19th', async () => {
    state.settings = { timezone: 'Australia/Sydney' };
    await createHourBlockPurchaseInvoiceInternal(baseInput());
    expect(state.insertedInvoices[0].invoice_date).toBe('2026-10-19');
  });

  it('without invoiceDate and no saved timezone, the UTC date is used', async () => {
    await createHourBlockPurchaseInvoiceInternal(baseInput());
    expect(state.insertedInvoices[0].invoice_date).toBe('2026-10-18');
  });
});
