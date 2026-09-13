import { describe, expect, it, vi, beforeEach } from 'vitest';

// The adapter resolves removed credit allocations through the tenant facade.
const tenantDbMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-x' })),
  tenantDb: tenantDbMock
}));

const xeroListChangedInvoices = vi.hoisted(() => vi.fn());
const xeroListChangedPayments = vi.hoisted(() => vi.fn());
const xeroListChangedCreditNotes = vi.hoisted(() => vi.fn());
const xeroCreate = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  XeroClientService: {
    create: xeroCreate
  }
}));

function makeTenantQueryBuilder(rows: unknown[] = []) {
  const builder: any = {};
  for (const method of ['select', 'where', 'whereNull', 'whereIn', 'whereRaw', 'andWhere', 'orderBy', 'limit']) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
  return builder;
}

let XeroAdapter: typeof import('./xeroAdapter').XeroAdapter;

beforeEach(async () => {
  vi.clearAllMocks();
  xeroCreate.mockResolvedValue({
    listChangedInvoices: xeroListChangedInvoices,
    listChangedPayments: xeroListChangedPayments,
    listChangedCreditNotes: xeroListChangedCreditNotes
  });
  xeroListChangedInvoices.mockResolvedValue({ records: [], hasMore: false });
  xeroListChangedPayments.mockResolvedValue({ records: [], hasMore: false });
  xeroListChangedCreditNotes.mockResolvedValue({ records: [], hasMore: false });
  tenantDbMock.mockReturnValue({ table: () => makeTenantQueryBuilder([]) });
  ({ XeroAdapter } = await import('./xeroAdapter'));
});

describe('XeroAdapter.fetchChanges', () => {
  it('requires a connection id', async () => {
    const adapter = await XeroAdapter.create();
    await expect(adapter.fetchChanges('tenant-x', '2026-01-01T00:00:00Z', null)).rejects.toThrow(/connection id/i);
  });

  it('normalizes changed invoices, payments and credit notes', async () => {
    xeroListChangedInvoices.mockResolvedValueOnce({
      records: [
        {
          InvoiceID: 'inv-1',
          InvoiceNumber: 'INV-0001',
          Status: 'AUTHORISED',
          Total: 120.5,
          UpdatedDateUTC: '/Date(1700000000000+0000)/',
          Type: 'ACCREC'
        }
      ],
      hasMore: false
    });
    xeroListChangedPayments.mockResolvedValueOnce({
      records: [
        {
          PaymentID: 'pay-1',
          Status: 'AUTHORISED',
          Amount: 50,
          Reference: 'STRIPE-1',
          Date: '2026-01-10T00:00:00Z',
          Invoice: { InvoiceID: 'inv-1' },
          UpdatedDateUTC: '/Date(1700000001000+0000)/'
        }
      ],
      hasMore: false
    });
    xeroListChangedCreditNotes.mockResolvedValueOnce({
      records: [
        {
          CreditNoteID: 'cn-1',
          CreditNoteNumber: 'CN-0001',
          Status: 'AUTHORISED',
          Total: 25,
          UpdatedDateUTC: '/Date(1700000002000+0000)/',
          Allocations: [
            {
              AllocationID: 'alloc-1',
              Amount: 25,
              Invoice: { InvoiceID: 'inv-1' },
              Date: '/Date(1700000003000+0000)/'
            }
          ]
        }
      ],
      hasMore: false
    });

    const adapter = await XeroAdapter.create();
    const result = await adapter.fetchChanges('tenant-x', '2026-01-01T00:00:00Z', 'conn-1');

    const invoice = result.changes.find((c) => c.entityType === 'Invoice');
    expect(invoice?.externalId).toBe('inv-1');
    expect(invoice?.normalized).toMatchObject({
      totalAmount: 120.5,
      docNumber: 'INV-0001',
      isVoided: false
    });
    expect(invoice?.updatedAt).toBe('2023-11-14T22:13:20.000Z');

    const payment = result.changes.find((c) => c.entityType === 'Payment' && c.externalId === 'pay-1');
    expect(payment?.normalized).toMatchObject({
      reference: 'STRIPE-1',
      allocations: [{ externalInvoiceId: 'inv-1', amountCents: 5000 }],
      isCreditApplication: false
    });

    const creditDocument = result.changes.find((c) => c.entityType === 'CreditMemo');
    expect(creditDocument?.externalId).toBe('cn-1');

    const allocation = result.changes.find((c) => c.externalId === 'creditnote:cn-1:alloc:alloc-1');
    expect(allocation).toBeDefined();
    expect(allocation?.normalized).toMatchObject({
      isCreditApplication: true,
      txnDate: '2023-11-14T22:13:23.000Z',
      allocations: [{ externalInvoiceId: 'inv-1', amountCents: 2500 }]
    });
    expect(result.truncated).toBe(false);
  });

  it('keeps two allocations to one invoice distinct when AllocationID is present', async () => {
    xeroListChangedCreditNotes.mockResolvedValueOnce({
      records: [
        {
          CreditNoteID: 'cn-dup',
          CreditNoteNumber: 'CN-0002',
          Status: 'AUTHORISED',
          Total: 30,
          UpdatedDateUTC: '2026-02-01T00:00:00Z',
          Allocations: [
            { AllocationID: 'a-1', Amount: 10, Invoice: { InvoiceID: 'inv-1' } },
            { AllocationID: 'a-2', Amount: 20, Invoice: { InvoiceID: 'inv-1' } }
          ]
        }
      ],
      hasMore: false
    });

    const adapter = await XeroAdapter.create();
    const result = await adapter.fetchChanges('tenant-x', '2026-01-01T00:00:00Z', 'conn-1');

    const allocations = result.changes.filter((c) => c.externalId.startsWith('creditnote:cn-dup:alloc:'));
    expect(allocations.map((c) => c.externalId).sort()).toEqual([
      'creditnote:cn-dup:alloc:a-1',
      'creditnote:cn-dup:alloc:a-2'
    ]);
    const amounts = allocations
      .map((c) => (c.normalized as any).allocations[0].amountCents)
      .sort((a: number, b: number) => a - b);
    expect(amounts).toEqual([1000, 2000]);
  });

  it('aggregates per invoice when Xero omits AllocationID', async () => {
    xeroListChangedCreditNotes.mockResolvedValueOnce({
      records: [
        {
          CreditNoteID: 'cn-agg',
          CreditNoteNumber: 'CN-0003',
          Status: 'AUTHORISED',
          Total: 30,
          UpdatedDateUTC: '2026-02-01T00:00:00Z',
          Allocations: [
            { Amount: 10, Invoice: { InvoiceID: 'inv-1' } },
            { Amount: 20, Invoice: { InvoiceID: 'inv-1' } }
          ]
        }
      ],
      hasMore: false
    });

    const adapter = await XeroAdapter.create();
    const result = await adapter.fetchChanges('tenant-x', '2026-01-01T00:00:00Z', 'conn-1');

    const aggregated = result.changes.find((c) => c.externalId === 'creditnote:cn-agg:inv:inv-1');
    expect(aggregated).toBeDefined();
    expect((aggregated?.normalized as any).allocations).toEqual([
      { externalInvoiceId: 'inv-1', amountCents: 3000 }
    ]);
  });

  it('paginates a full page before returning', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      InvoiceID: `inv-${index}`,
      InvoiceNumber: `INV-${index}`,
      Status: 'AUTHORISED',
      Total: 1,
      UpdatedDateUTC: '/Date(1700000000000+0000)/'
    }));
    xeroListChangedInvoices
      .mockResolvedValueOnce({ records: fullPage, hasMore: true })
      .mockResolvedValueOnce({ records: [{ InvoiceID: 'inv-last', Status: 'AUTHORISED', Total: 2 }], hasMore: false });

    const adapter = await XeroAdapter.create();
    const result = await adapter.fetchChanges('tenant-x', '2026-01-01T00:00:00Z', 'conn-1');

    expect(xeroListChangedInvoices).toHaveBeenCalledTimes(2);
    expect(xeroListChangedInvoices).toHaveBeenNthCalledWith(1, '2026-01-01T00:00:00Z', 1);
    expect(xeroListChangedInvoices).toHaveBeenNthCalledWith(2, '2026-01-01T00:00:00Z', 2);
    expect(result.changes.filter((c) => c.entityType === 'Invoice')).toHaveLength(101);
  });

  it('does not emit a resume boundary when any feed is truncated (mixed feeds)', async () => {
    // The invoice feed never completes and its records stop at January 2...
    xeroListChangedInvoices.mockImplementation(async (_since: string, page: number) => ({
      records: [
        {
          InvoiceID: `invoice-${page}`,
          Status: 'AUTHORISED',
          Total: 1,
          UpdatedDateUTC: '2026-01-02T00:00:00.000Z'
        }
      ],
      hasMore: true
    }));
    // ...while the payment feed completes with a much newer January 20 record.
    xeroListChangedPayments.mockResolvedValue({
      records: [
        {
          PaymentID: 'recent-payment',
          Amount: 1,
          Invoice: { InvoiceID: 'other-invoice' },
          UpdatedDateUTC: '2026-01-20T00:00:00.000Z'
        }
      ],
      hasMore: false
    });

    const adapter = await XeroAdapter.create();
    const result = await adapter.fetchChanges('tenant-x', '2026-01-01T00:00:00Z', 'conn-1');

    expect(result.truncated).toBe(true);
    // The newer completed feed must NOT provide a resume boundary: January 3+
    // invoice pages are still unread. No boundary means the cycle keeps its
    // cursor and re-polls the same window.
    expect(result.nextCursor).toBeUndefined();
  });

  it('does not advance past a block of identical timestamps that exceeds the cap', async () => {
    xeroListChangedInvoices.mockImplementation(async (_since: string, page: number) => ({
      records: [
        {
          InvoiceID: `same-timestamp-${page}`,
          Status: 'AUTHORISED',
          Total: 1,
          UpdatedDateUTC: '2026-01-05T00:00:00.000Z'
        }
      ],
      hasMore: true
    }));

    const adapter = await XeroAdapter.create();
    const result = await adapter.fetchChanges('tenant-x', '2026-01-01T00:00:00Z', 'conn-1');

    expect(result.truncated).toBe(true);
    expect(result.nextCursor).toBeUndefined();
  });

  it('tolerates records with missing timestamps without throwing', async () => {
    xeroListChangedInvoices.mockResolvedValueOnce({
      records: [{ InvoiceID: 'no-date', Status: 'AUTHORISED', Total: 3 }],
      hasMore: false
    });

    const adapter = await XeroAdapter.create();
    const result = await adapter.fetchChanges('tenant-x', '2026-01-01T00:00:00Z', 'conn-1');
    const change = result.changes.find((c) => c.externalId === 'no-date');
    expect(change).toBeDefined();
    expect(change?.updatedAt).toBeUndefined();
  });

  it('propagates a mid-pagination failure so the cycle keeps its cursor', async () => {
    xeroListChangedInvoices
      .mockResolvedValueOnce({ records: [{ InvoiceID: 'inv-p1', Status: 'AUTHORISED', Total: 1 }], hasMore: true })
      .mockRejectedValueOnce(new Error('Xero API error on page 2'));

    const adapter = await XeroAdapter.create();
    await expect(adapter.fetchChanges('tenant-x', '2026-01-01T00:00:00Z', 'conn-1')).rejects.toThrow(
      /page 2/
    );
  });

  it('marks voided/deleted documents and emits a deletion for a removed allocation', async () => {
    xeroListChangedInvoices.mockResolvedValueOnce({
      records: [{ InvoiceID: 'inv-void', Status: 'VOIDED', Total: 0, UpdatedDateUTC: '/Date(1+0000)/' }],
      hasMore: false
    });
    xeroListChangedCreditNotes.mockResolvedValueOnce({
      records: [
        {
          CreditNoteID: 'cn-2',
          CreditNoteNumber: 'CN-0002',
          Status: 'AUTHORISED',
          Total: 10,
          UpdatedDateUTC: '/Date(2+0000)/',
          // No allocations now — the previously recorded allocation was removed.
          Allocations: []
        }
      ],
      hasMore: false
    });
    // The stored ledger row for the removed allocation.
    tenantDbMock.mockReturnValue({
      table: () =>
        makeTenantQueryBuilder([
          {
            external_entity_id: 'creditnote:cn-2:inv-9',
            metadata: { xero_credit_note_id: 'cn-2' }
          }
        ])
    });

    const adapter = await XeroAdapter.create();
    const result = await adapter.fetchChanges('tenant-x', '2026-01-01T00:00:00Z', 'conn-1');

    const voided = result.changes.find((c) => c.externalId === 'inv-void');
    expect(voided?.normalized).toMatchObject({ isVoided: true });
    expect(voided?.deleted).toBe(false);

    const removed = result.changes.find((c) => c.externalId === 'creditnote:cn-2:inv-9');
    expect(removed?.deleted).toBe(true);
  });
});
