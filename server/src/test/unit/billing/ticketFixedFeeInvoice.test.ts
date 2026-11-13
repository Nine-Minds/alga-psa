import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IFixedPriceCharge, ManualInvoiceSourceLink } from '@alga-psa/types';
import type { Knex } from 'knex';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  connect: vi.fn(),
  facade: vi.fn(),
  recordAccess: vi.fn(),
  generate: vi.fn(),
  tax: vi.fn(),
  TicketRecordAccessDeniedError: class extends Error {
    constructor() {
      super('Permission denied: Cannot access ticket');
      this.name = 'TicketRecordAccessDeniedError';
    }
  },
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => action({ user_id: 'user-a' }, { tenant: 'tenant-a' }, ...args),
  hasPermission: mocks.permission,
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.connect,
  tenantDb: mocks.facade,
  withTransaction: (_db: unknown, callback: (trx: object) => unknown) => callback({}),
}));
vi.mock('@alga-psa/authorization/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: mocks.recordAccess,
  TicketRecordAccessDeniedError: mocks.TicketRecordAccessDeniedError,
}));
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
import { TicketRecordAccessDeniedError } from '@alga-psa/authorization/ticketRecordAuthorization';
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
    first: vi.fn(async (...columns: unknown[]) => {
      if (requiredVersion && requiredVersion !== row?.updated_at) return undefined;
      const versionCheck = columns.find((column): column is { versionCheck: string } =>
        typeof column === 'object' && column !== null && 'versionCheck' in column);
      return row && versionCheck ? { ...row, version_matches: versionCheck.versionCheck === row.updated_at } : row;
    }),
    insert: vi.fn(async () => 1),
    update: vi.fn(async () => 1),
    then: (resolve: (value: Record<string, unknown>[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}
let tables: Record<string, ReturnType<typeof query>>;
// The validation version check is a raw select expression; the claim is a raw UPDATE.
const transaction = (rows: Array<{ source_id: string }> = [{ source_id: 'fee-a' }]) => {
  const raw = vi.fn((sql: string, bindings: unknown[] = []) => (sql.includes('AS version_matches')
    ? { versionCheck: String(bindings[0]) }
    : Promise.resolve({ rows })));
  return { trx: { raw } as unknown as Knex.Transaction, raw };
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.connect.mockResolvedValue({ knex: { raw: vi.fn((sql: string) => sql) } });
  mocks.recordAccess.mockResolvedValue({});
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
    await generateTicketInvoice({
      ticketId: 'ticket-a', timeEntryIds: [], materialIds: [], fixedFeeIds: ['fee-a', 'fee-a'], sourceVersions: { 'fee-a': version },
    });
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
    expect(mocks.recordAccess).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-a', ticketId: 'ticket-a', action: 'update',
    }));
  });

  it('lists same-currency fees and reports exclusions', async () => {
    tables['ticket_fixed_fee_services as f'] = query(undefined, [{ ...fee }, { ...fee, entry_id: 'fee-eur', currency_code: 'EUR' }]);
    expect(await getTicketBillableItems('ticket-a')).toMatchObject({
      fixedFeeItems: [{ id: 'fee-a', quantity: 2, rate: 2500, amount: 5000, version }],
      excludedFixedFeeCount: 1,
    });
    expect(tables['ticket_fixed_fee_services as f'].where).toHaveBeenCalledWith({
      'f.ticket_id': 'ticket-a', 'f.client_id': 'client-a', 'f.is_billed': false,
    });
    expect(tables['ticket_materials as tm'].where).toHaveBeenCalledWith({
      'tm.ticket_id': 'ticket-a', 'tm.client_id': 'client-a', 'tm.is_billed': false,
    });
    expect(mocks.recordAccess).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-a', ticketId: 'ticket-a', action: 'read',
    }));
  });

  it('requires record-level ticket access before listing billable sources', async () => {
    mocks.recordAccess.mockRejectedValueOnce(new TicketRecordAccessDeniedError());
    const result = await getTicketBillableItems('ticket-a');
    expect(result).toHaveProperty('permissionError');
    expect(tables['time_entries as te'].where).not.toHaveBeenCalled();
    expect(tables['ticket_fixed_fee_services as f'].where).not.toHaveBeenCalled();
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
      ticketId: 'ticket-a', timeEntryIds: [], materialIds: [], fixedFeeIds: ['fee-a'], sourceVersions: { 'fee-a': version },
    })).toMatchObject({ success: false, code: 'SOURCE_CURRENCY_MISMATCH' });
  });

  it.each([
    ['missing', undefined],
    ['older than the stored entry', { 'fee-a': '2026-10-27 12:00:00.123455+00' }],
  ])('rejects a selection whose reviewed version is %s', async (_case, sourceVersions) => {
    expect(await generateTicketInvoice({
      ticketId: 'ticket-a', timeEntryIds: [], materialIds: [], fixedFeeIds: ['fee-a'], sourceVersions,
    })).toMatchObject({ success: false, code: 'SOURCE_CHANGED', params: { recordId: 'fee-a' } });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('requires billing create permission', async () => {
    mocks.permission.mockResolvedValue(false);
    expect(await generateTicketInvoice({
      ticketId: 'ticket-a', timeEntryIds: [], materialIds: [], fixedFeeIds: ['fee-a'],
    })).toMatchObject({ success: false, code: 'PERMISSION_DENIED' });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('requires record-level ticket access before generating a quick invoice', async () => {
    mocks.recordAccess.mockRejectedValueOnce(new TicketRecordAccessDeniedError());
    expect(await generateTicketInvoice({
      ticketId: 'ticket-a', timeEntryIds: [], materialIds: [], fixedFeeIds: ['fee-a'],
    })).toMatchObject({ success: false, code: 'PERMISSION_DENIED' });
    expect(tables['ticket_fixed_fee_services as f'].where).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});

describe('manual invoice fixed-fee and edited material source lifecycle', () => {
  const persist = (source_link: ManualInvoiceSourceLink, overrides: Record<string, unknown> = {}) =>
    persistManualInvoiceCharges(
      transaction(source_link.kind === 'ticket_material' ? [{ source_id: 'material-a' }] : [{ source_id: 'fee-a' }]).trx, 'invoice-a',
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
    expect(tables.ticket_fixed_fee_services.update).not.toHaveBeenCalled();
    expect(tables.ticket_fixed_fee_services.forUpdate).toHaveBeenCalled();
    expect(mocks.facade).toHaveBeenCalledWith(expect.objectContaining({ raw: expect.any(Function) }), 'tenant-a');
  });

  describe('scheduled fixed-fee source claims', () => {
    const charge: IFixedPriceCharge = {
      type: 'fixed', serviceId: 'service-a', serviceName: 'Setup',
      quantity: 2, rate: 2500, total: 5000, unit_code: 'EA',
      ticket_fixed_fee_id: 'fee-a', ticket_fixed_fee_updated_at: version,
      is_taxable: true, tax_region: 'service-region', tax_amount: 250, tax_rate: 5,
    };
    const tx = transaction([{ source_id: 'fee-a' }]);
    const persist = () => persistInvoiceCharges(
      tx.trx, 'invoice-a', [{ ...charge }],
      { client_id: 'client-a', tax_region: 'client-region' },
      { user: { id: 'user-a' } } as never, 'tenant-a',
    );

    it('uses the simple fixed charge path, preserves service tax region, and claims the exact snapshot', async () => {
      expect(await persist()).toBe(5000);
      expect(tables.invoice_charges.insert).toHaveBeenCalledWith(expect.objectContaining({
        quantity: 2, unit_price: 2500, net_amount: 5000, tax_region: 'service-region', is_manual: false,
      }));
      const [claimSql, claimBindings] = tx.raw.mock.calls[0];
      expect(claimSql).toContain('UPDATE ticket_fixed_fee_services AS source');
      expect(claimSql).toContain('source.tenant = ?');
      expect(claimSql).toContain('source.currency_code = requested.currency_code');
      expect(claimBindings).toContain('tenant-a');
      expect(claimBindings).toContain('USD');
      expect(tx.raw).toHaveBeenCalledTimes(1);
    });

    it('aborts persistence when an edit or another invoice changed the source', async () => {
      tx.raw.mockResolvedValueOnce({ rows: [] });
      await expect(persist()).rejects.toMatchObject({
        code: 'SOURCE_CHANGED',
        message: expect.stringContaining('changed or was already billed'),
      });
    });

    // Evaluates the claim's VALUES bindings against seeded rows, so the
    // version/billed/tenant predicates decide the outcome rather than a stub.
    const seededClaim = (seeded: Array<Record<string, unknown>>) => {
      const raw = vi.fn(async (sql: string, bindings: unknown[]) => {
        expect(sql).toMatch(/WHERE source\.tenant = \?/);
        expect(sql).toContain('source.updated_at = requested.source_updated_at');
        expect(sql).toContain('source.is_billed = FALSE');
        const [invoiceId, , updatedAt] = bindings;
        const tenant = bindings.at(-1);
        const values = bindings.slice(3, -1);
        const rows: Array<{ source_id: string }> = [];
        for (let index = 0; index < values.length; index += 7) {
          const [sourceId, sourceUpdatedAt, clientId, serviceId, quantity, rate, currencyCode] = values.slice(index, index + 7);
          const row = seeded.find((candidate) => candidate.entry_id === sourceId && candidate.tenant === tenant &&
            candidate.updated_at === sourceUpdatedAt && candidate.is_billed === false &&
            candidate.client_id === clientId && candidate.service_id === serviceId &&
            candidate.quantity === quantity && candidate.rate === rate && candidate.currency_code === currencyCode);
          if (!row) continue;
          Object.assign(row, { is_billed: true, billed_invoice_id: invoiceId, updated_at: updatedAt });
          rows.push({ source_id: String(sourceId) });
        }
        return { rows };
      });
      return { trx: { raw } as unknown as Knex.Transaction, raw };
    };
    const persistSeeded = (trx: Knex.Transaction) => persistInvoiceCharges(
      trx, 'invoice-a', [{ ...charge }],
      { client_id: 'client-a', tax_region: 'client-region' },
      { user: { id: 'user-a' } } as never, 'tenant-a',
    );

    it('claims a seeded fee whose stored version still matches the calculated charge', async () => {
      const row = { ...fee, tenant: 'tenant-a' };
      expect(await persistSeeded(seededClaim([row]).trx)).toBe(5000);
      expect(row).toMatchObject({ is_billed: true, billed_invoice_id: 'invoice-a' });
    });

    it.each([
      ['edited after calculation', { updated_at: '2026-10-27 12:00:00.123457+00' }],
      ['already billed', { is_billed: true }],
      ['owned by another tenant', { tenant: 'tenant-b' }],
      ['repriced after calculation', { rate: 3000 }],
    ])('rejects a seeded fee that was %s without claiming it', async (_case, changes) => {
      const row = { ...fee, tenant: 'tenant-a', ...changes };
      const before = { ...row };
      await expect(persistSeeded(seededClaim([row]).trx)).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
      expect(row).toEqual(before);
    });
  });

  it('rejects stale microsecond versions, including description-only edits', async () => {
    await expect(persist({ ...link, updatedAt: '2026-10-27 12:00:00.123455+00' })).rejects.toMatchObject({
      code: 'SOURCE_CHANGED',
    });
    expect(tables.invoice_charges.insert).not.toHaveBeenCalled();
  });

  it('rejects a source link without a loaded version', async () => {
    await expect(persist({ ...link, updatedAt: '' })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    await expect(persist({ kind: 'ticket_material', materialId: 'material-a', updatedAt: '' }))
      .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect(tables.invoice_charges.insert).not.toHaveBeenCalled();
  });

  it('applies the exact stored material rate the claim requires', async () => {
    tables.ticket_materials = query({
      ticket_material_id: 'material-a', ticket_id: 'ticket-a', client_id: 'client-a',
      service_id: 'service-a', quantity: 2, rate: 2500.4, currency_code: 'USD', updated_at: version,
    });
    await expect(persist({ kind: 'ticket_material', materialId: 'material-a', updatedAt: version }))
      .rejects.toMatchObject({ code: 'SOURCE_NOT_ELIGIBLE' });
    expect(tables.invoice_charges.insert).not.toHaveBeenCalled();
  });

  it('rejects stale edited material versions before persisting a charge', async () => {
    await expect(persist({
      kind: 'ticket_material', materialId: 'material-a', updatedAt: '2026-10-27 12:00:00.123455+00',
    })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
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
    const concurrentClaim = transaction([]);
    await expect(persistManualInvoiceCharges(
      concurrentClaim.trx,
      'invoice-a',
      [{ service_id: 'service-a', quantity: 2, rate: 2500, description: 'Setup', source_link: link }],
      { client_id: 'client-a', region_code: null },
      { user: { id: 'user-a' } } as never,
      'tenant-a',
    )).rejects.toMatchObject({ code: 'SOURCE_ALREADY_BILLED' });
  });
});

describe('scheduled ticket fixed-fee calculation', () => {
  const taxInfo = vi.fn();
  const clientRegion = vi.fn();
  const calculate = async () => {
    const engine = BillingEngine.forTransaction({ raw: (sql: string) => sql } as never, 'tenant-a');
    Reflect.set(engine, 'getTaxInfoFromService', taxInfo);
    Reflect.set(engine, 'getClientDefaultTaxRegionCode', clientRegion);
    const method = Reflect.get(engine, 'calculateTicketFixedFeeCharges');
    if (typeof method !== 'function') throw new Error('Ticket fixed-fee calculator is missing');
    return method.call(engine, 'client-a', { startDate: '2026-10-01', endDate: '2026-11-01' }, 'USD');
  };
  beforeEach(() => {
    taxInfo.mockReset().mockResolvedValue({ taxRegion: 'service-region', isTaxable: true });
    clientRegion.mockReset().mockResolvedValue('client-region');
  });

  it('resolves tax info once per service and the client default region once per run', async () => {
    taxInfo.mockResolvedValue({ taxRegion: null, isTaxable: true });
    tables['ticket_fixed_fee_services as f'] = query(undefined, [
      { ...fee }, { ...fee, entry_id: 'fee-b' }, { ...fee, entry_id: 'fee-c', service_id: 'service-b' },
    ]);
    const charges = await calculate();
    expect(charges).toHaveLength(3);
    expect(charges.every((charge: IFixedPriceCharge) => charge.tax_region === 'client-region')).toBe(true);
    expect(taxInfo).toHaveBeenCalledTimes(2);
    expect(clientRegion).toHaveBeenCalledTimes(1);
  });

  it('calculates quantity times catalog price, taxes, and exact provenance before the end-exclusive boundary', async () => {
    expect(await calculate()).toEqual([expect.objectContaining({
      type: 'fixed', serviceId: 'service-a', serviceName: 'Setup',
      quantity: 2, rate: 2500, total: 5000, tax_amount: 250, tax_rate: 5,
      ticket_fixed_fee_id: 'fee-a', ticket_fixed_fee_updated_at: version,
    })]);
    const where = tables['ticket_fixed_fee_services as f'].where;
    expect(where).toHaveBeenCalledWith({ 'f.client_id': 'client-a', 'f.is_billed': false, 'f.currency_code': 'USD' });
    expect(where).not.toHaveBeenCalledWith('f.created_at', '>=', '2026-10-01');
    expect(where).toHaveBeenCalledWith('f.created_at', '<', '2026-11-01');
    expect(mocks.tax).toHaveBeenCalledWith('client-a', 5000, '2026-11-01', 'service-region', true, 'USD');
  });

  it('fails visibly for invalid stored amounts instead of silently invoicing a fallback', async () => {
    tables['ticket_fixed_fee_services as f'] = query(undefined, [{ ...fee, quantity: -1 }]);
    await expect(calculate()).rejects.toThrow('invalid quantity or rate');
  });
});
