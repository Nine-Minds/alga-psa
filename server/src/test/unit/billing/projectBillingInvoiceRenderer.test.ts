import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  rows: new Map<string, any[]>(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    tenantJoin: vi.fn(),
    table: vi.fn((table: string) => {
      const rows = [...(dbState.rows.get(table) ?? [])];
      const query: any = {
        where: vi.fn(() => query),
        whereNotNull: vi.fn(() => query),
        whereIn: vi.fn(() => query),
        select: vi.fn(() => Promise.resolve(rows)),
        first: vi.fn(() => Promise.resolve(rows[0])),
        then: (resolve: (value: any[]) => unknown, reject?: (reason: unknown) => unknown) => (
          Promise.resolve(rows).then(resolve, reject)
        ),
      };
      return query;
    }),
  })),
}));

import { enrichInvoiceViewModelWithLocations } from '@alga-psa/billing/lib/adapters/invoiceAdapters.server';

describe('standalone project invoice rendering (T038)', () => {
  beforeEach(() => {
    dbState.rows = new Map([
      ['invoices as invoice', [{
        project_id: 'project-1',
        project_name: 'Datacenter migration',
        project_number: 'PRJ-100',
      }]],
      ['project_billing_schedule_entries as entry', [{
        item_id: 'charge-1',
        project_name: 'Datacenter migration',
        project_number: 'PRJ-100',
        phase_name: 'Cutover',
      }]],
      ['invoice_time_entries as invoice_time', []],
      ['invoice_charges', [{ item_id: 'charge-1' }]],
    ]);
  });

  it('resolves invoice-level project name/number and project line metadata for template variables', async () => {
    const viewModel: any = {
      invoiceNumber: 'INV-100',
      customer: { name: 'Acme', address: '' },
      items: [{
        id: 'charge-1',
        description: 'Final milestone',
        quantity: 1,
        unitPrice: 10_000,
        total: 10_000,
        taxAmount: 0,
        location_id: null,
        location: null,
      }],
      subtotal: 10_000,
      tax: 0,
      total: 10_000,
      currencyCode: 'USD',
      __invoiceId: 'invoice-1',
    };

    const enriched = await enrichInvoiceViewModelWithLocations({} as never, 'tenant-1', viewModel);

    expect(enriched).toMatchObject({
      projectName: 'Datacenter migration',
      projectNumber: 'PRJ-100',
      items: [{
        id: 'charge-1',
        category: 'Project: Datacenter migration',
        itemType: 'project',
        projectPhaseName: 'Cutover',
      }],
    });
  });
});
