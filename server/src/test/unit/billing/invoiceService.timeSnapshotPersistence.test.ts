import { describe, expect, it } from 'vitest';

import { persistInvoiceCharges } from '../../../../../packages/billing/src/services/invoiceService';
import type { ITimeBasedCharge, InvoiceTimeEntrySnapshot } from '../../../../../packages/types/src';

// Same rationale as invoiceService.manualPeriodPolicy.test.ts: these suites
// mock knex, so the billing-profile reads are stubbed; profile attribution is
// covered by its own resolver/integration suites.
vi.mock('@alga-psa/shared/billingClients/billingProfiles', async (importOriginal) =>
  (await import('../../../../test-utils/billingProfileUnitStub')).billingProfilesModuleStub(importOriginal as any));
vi.mock('@alga-psa/shared/billingClients/billingProfileSettings', async (importOriginal) =>
  (await import('../../../../test-utils/billingProfileUnitStub')).billingProfileSettingsModuleStub(importOriginal as any));

function normalizeColumnName(columnName: string) {
  const [, unqualifiedName] = columnName.match(/^(?:[^.]+)\.(.+)$/) ?? [];
  return unqualifiedName ?? columnName;
}

function createMockTx(seedTables: Record<string, Array<Record<string, any>>> = {}) {
  const inserts: Record<string, any[]> = {
    invoice_charges: [],
    invoice_charge_details: [],
    invoice_time_entries: [],
  };

  const tables: Record<string, Array<Record<string, any>>> = {
    invoice_charges: [],
    invoice_charge_details: [],
    invoice_time_entries: [],
    time_entries: [],
    ...Object.fromEntries(
      Object.entries(seedTables).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]),
    ),
  };

  const tx: any = (tableName: string) => {
    let filteredRows = tables[tableName] ?? [];

    const builder: any = {
      where(criteria: Record<string, any> | string, value?: unknown) {
        filteredRows = filteredRows.filter((row) => {
          if (typeof criteria === 'string') {
            return row[normalizeColumnName(criteria)] === value;
          }
          return Object.entries(criteria).every(
            ([key, expected]) => row[normalizeColumnName(key)] === expected,
          );
        });
        return builder;
      },
      select() {
        return builder;
      },
      async first() {
        return filteredRows[0] ?? null;
      },
      async update(patch: Record<string, any>) {
        for (const row of filteredRows) {
          Object.assign(row, patch);
        }
        return filteredRows.length;
      },
      async insert(payload: any) {
        inserts[tableName] ??= [];
        inserts[tableName].push(payload);
        tables[tableName] ??= [];
        tables[tableName].push(payload);
        return [payload];
      },
    };

    return builder;
  };

  return { tx, inserts };
}

const SNAPSHOT: InvoiceTimeEntrySnapshot = {
  version: 1,
  workItemType: 'ticket',
  workItemId: 'ticket-1',
  ticketNumber: 'T-20260901-004',
  title: 'Email outage',
  description: 'Mail flow failed for all users.',
  entryDate: '2026-08-05',
  billedMinutes: 90,
  rate: 15000,
  netAmount: 22500,
  serviceId: 'svc-h',
  serviceName: 'Remote Support',
};

function timeCharge(overrides: Partial<ITimeBasedCharge> = {}): ITimeBasedCharge {
  return {
    type: 'time',
    serviceId: 'svc-h',
    serviceName: 'Remote Support',
    userId: 'user-1',
    duration: 1.5,
    quantity: 1.5,
    rate: 15000,
    total: 22500,
    tax_amount: 0,
    tax_rate: 0,
    entryId: 'entry-1',
    is_taxable: false,
    ...overrides,
  } as ITimeBasedCharge;
}

const CLIENT = { client_id: 'client-1', tax_region: 'US-WA' };
const SESSION = { user: { id: 'user-1' } } as any;

describe('persistInvoiceCharges billed-time snapshot persistence', () => {
  it('freezes the work-item snapshot onto the invoice_time_entries link row', async () => {
    const { tx, inserts } = createMockTx({
      time_entries: [{ tenant: 'tenant-1', entry_id: 'entry-1', invoiced: false }],
    });

    await persistInvoiceCharges(
      tx,
      'invoice-1',
      [timeCharge({ workItemSnapshot: SNAPSHOT })],
      CLIENT,
      SESSION,
      'tenant-1',
      { requireRecurringServicePeriodLinkage: false },
    );

    expect(inserts.invoice_time_entries).toHaveLength(1);
    const linkRow = inserts.invoice_time_entries[0];
    expect(linkRow.entry_id).toBe('entry-1');
    expect(linkRow.item_id).toBe(inserts.invoice_charges[0].item_id);
    expect(JSON.parse(linkRow.work_item_snapshot)).toEqual(SNAPSHOT);
  });

  it('writes NULL snapshot for charges without one (legacy engine paths stay valid)', async () => {
    const { tx, inserts } = createMockTx({
      time_entries: [{ tenant: 'tenant-1', entry_id: 'entry-1', invoiced: false }],
    });

    await persistInvoiceCharges(
      tx,
      'invoice-1',
      [timeCharge()],
      CLIENT,
      SESSION,
      'tenant-1',
      { requireRecurringServicePeriodLinkage: false },
    );

    expect(inserts.invoice_time_entries).toHaveLength(1);
    expect(inserts.invoice_time_entries[0].work_item_snapshot).toBeNull();
  });

  it('keeps the canonical accounting-facing description as the service name', async () => {
    const { tx, inserts } = createMockTx({
      time_entries: [{ tenant: 'tenant-1', entry_id: 'entry-1', invoiced: false }],
    });

    await persistInvoiceCharges(
      tx,
      'invoice-1',
      [timeCharge({ workItemSnapshot: SNAPSHOT })],
      CLIENT,
      SESSION,
      'tenant-1',
      { requireRecurringServicePeriodLinkage: false },
    );

    // QBO/Xero exports read invoice_charges.description; the ticket snapshot
    // must never leak into it.
    expect(inserts.invoice_charges).toHaveLength(1);
    expect(inserts.invoice_charges[0].description).toBe('Remote Support');
    expect(inserts.invoice_charges[0].description).not.toContain('T-20260901-004');
    expect(JSON.stringify(inserts.invoice_charges[0])).not.toContain('Mail flow failed');
  });
});
