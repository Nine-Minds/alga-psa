import { describe, expect, it, vi } from 'vitest';

import Invoice from '@alga-psa/billing/models/invoice';

/**
 * Who the invoice says it is billed to.
 *
 * A billing profile is how a client merged under a parent keeps its own billing
 * identity, and the bill-to line is where that identity is either honoured or
 * lost. Printing the parent's name on an invoice raised against the merged
 * profile is the visible half of the same bug that emails it to the parent's
 * inbox. Inheritance runs field by field, so a profile that fills nothing in
 * must render exactly the client it always did.
 */

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn(async () => null),
  getClientDocumentLogoUrl: vi.fn(async () => null),
}));

type Row = Record<string, any>;

function normalizeColumn(column: string): string {
  return column.replace(/^.*\./, '');
}

function createQueryBuilder(rows: Row[]) {
  let resultRows = [...rows];

  const builder: any = {
    join: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn((columnOrCriteria: string | Record<string, any>, value?: any) => {
      if (typeof columnOrCriteria === 'string') {
        resultRows = resultRows.filter((row) => row[normalizeColumn(columnOrCriteria)] === value);
        return builder;
      }
      resultRows = resultRows.filter((row) =>
        Object.entries(columnOrCriteria).every(([key, expected]) => row[normalizeColumn(key)] === expected)
      );
      return builder;
    }),
    whereNull: vi.fn((column: string) => {
      resultRows = resultRows.filter((row) => row[normalizeColumn(column)] == null);
      return builder;
    }),
    whereIn: vi.fn((column: string, values: any[]) => {
      resultRows = resultRows.filter((row) => values.includes(row[normalizeColumn(column)]));
      return builder;
    }),
    orderBy: vi.fn().mockReturnThis(),
    orderByRaw: vi.fn().mockReturnThis(),
    first: vi.fn(async () => resultRows[0]),
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultRows).then(resolve, reject),
  };

  return builder;
}

function createMockKnex(tables: Record<string, Row[]>) {
  const touched: string[] = [];
  const knex: any = vi.fn((tableName: string) => {
    const normalizedTableName = tableName.split(/\s+as\s+/i)[0].trim();
    touched.push(normalizedTableName);
    return createQueryBuilder(tables[normalizedTableName] ?? []);
  });
  knex.raw = vi.fn((sql: string) => sql);
  knex.touchedTables = touched;

  return knex;
}

const TENANT = 'tenant-1';
const CLIENT_ID = 'client-1';

const invoiceRow = (overrides: Row = {}): Row => ({
  invoice_id: 'invoice-1',
  tenant: TENANT,
  client_id: CLIENT_ID,
  invoice_number: 'INV001012',
  invoice_date: '2026-09-01',
  due_date: '2026-10-01',
  status: 'draft',
  subtotal: 10000,
  tax: 0,
  total_amount: 10000,
  credit_applied: 0,
  currency_code: 'USD',
  is_manual: true,
  billing_profile_id: null,
  ...overrides,
});

const clientRow = (): Row => ({
  tenant: TENANT,
  client_id: CLIENT_ID,
  client_name: 'Northstar Dental Group',
  properties: {},
  location_address: '1 Parent Plaza, Emerald City',
});

const profileRow = (overrides: Row = {}): Row => ({
  tenant: TENANT,
  billing_profile_id: 'profile-merged',
  client_id: CLIENT_ID,
  name: '12345',
  bill_to_name: null,
  bill_to_location_id: null,
  is_default: false,
  ...overrides,
});

const defaultProfileRow = (): Row => ({
  tenant: TENANT,
  billing_profile_id: 'profile-default',
  client_id: CLIENT_ID,
  name: 'Northstar Dental Group',
  bill_to_name: null,
  bill_to_location_id: null,
  is_default: true,
});

const baseTables = (overrides: Record<string, Row[]> = {}) => ({
  invoices: [invoiceRow()],
  clients: [clientRow()],
  contacts: [],
  tenant_companies: [],
  tenants: [{ tenant: TENANT, client_name: 'Emerald City MSP' }],
  invoice_charges: [],
  invoice_charge_details: [],
  recurring_service_periods: [],
  client_billing_profiles: [],
  client_locations: [],
  ...overrides,
});

describe('invoice bill-to follows the billing profile it bills', () => {
  it('prints the profile bill-to name instead of the parent client name', async () => {
    const knex = createMockKnex(baseTables({
      invoices: [invoiceRow({ billing_profile_id: 'profile-merged' })],
      client_billing_profiles: [
        defaultProfileRow(),
        profileRow({ bill_to_name: 'Northstar Dental — Munchkinland' }),
      ],
    }));

    const invoice = await Invoice.getFullInvoiceById(knex, TENANT, 'invoice-1');

    expect(invoice.client.name).toBe('Northstar Dental — Munchkinland');
    expect(invoice.billing_profile_id).toBe('profile-merged');
    expect(invoice.billing_profile_name).toBe('12345');
    expect(invoice.client_has_multiple_billing_profiles).toBe(true);
  });

  it('bills to the address of the profile bill-to location', async () => {
    const knex = createMockKnex(baseTables({
      invoices: [invoiceRow({ billing_profile_id: 'profile-merged' })],
      client_billing_profiles: [
        defaultProfileRow(),
        profileRow({ bill_to_location_id: 'loc-site' }),
      ],
      client_locations: [{
        tenant: TENANT,
        client_id: CLIENT_ID,
        location_id: 'loc-site',
        location_address: '42 Yellow Brick Road, Munchkinland',
      }],
    }));

    const invoice = await Invoice.getFullInvoiceById(knex, TENANT, 'invoice-1');

    expect(invoice.client.address).toBe('42 Yellow Brick Road, Munchkinland');
  });

  it('inherits the client name for a profile that names no bill-to', async () => {
    const knex = createMockKnex(baseTables({
      invoices: [invoiceRow({ billing_profile_id: 'profile-merged' })],
      client_billing_profiles: [defaultProfileRow(), profileRow()],
    }));

    const invoice = await Invoice.getFullInvoiceById(knex, TENANT, 'invoice-1');

    expect(invoice.client.name).toBe('Northstar Dental Group');
    expect(invoice.client.address).toBe('1 Parent Plaza, Emerald City');
    expect(invoice.billing_profile_name).toBe('12345');
  });

  it('leaves a pre-profile invoice untouched and asks the profile table nothing', async () => {
    const knex = createMockKnex(baseTables({
      client_billing_profiles: [defaultProfileRow(), profileRow({ bill_to_name: 'Somewhere Else' })],
    }));

    const invoice = await Invoice.getFullInvoiceById(knex, TENANT, 'invoice-1');

    expect(invoice.client.name).toBe('Northstar Dental Group');
    expect(invoice.billing_profile_id).toBeNull();
    expect(invoice.billing_profile_name).toBeNull();
    // D6: an invoice with no profile carries no profile surface at all, and
    // costs no extra read for the clients nobody has segmented.
    expect(invoice.client_has_multiple_billing_profiles).toBe(false);
    expect(knex.touchedTables).not.toContain('client_billing_profiles');
  });

  it('keeps the profile invisible for a client that holds only one', async () => {
    const knex = createMockKnex(baseTables({
      invoices: [invoiceRow({ billing_profile_id: 'profile-default' })],
      client_billing_profiles: [defaultProfileRow()],
    }));

    const invoice = await Invoice.getFullInvoiceById(knex, TENANT, 'invoice-1');

    expect(invoice.client_has_multiple_billing_profiles).toBe(false);
    expect(invoice.client.name).toBe('Northstar Dental Group');
  });
});
