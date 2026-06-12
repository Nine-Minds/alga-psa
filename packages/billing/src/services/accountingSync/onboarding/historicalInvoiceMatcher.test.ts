import { describe, it, expect } from 'vitest';
import { matchHistoricalInvoices, type QboInvoiceRow, type AlgaInvoiceRow } from './historicalInvoiceMatcher';

function makeAlgaInvoice(overrides: Partial<AlgaInvoiceRow> = {}): AlgaInvoiceRow {
  return {
    invoice_id: 'inv-1',
    invoice_number: 'INV-001',
    total_amount: 10000, // cents
    client_id: 'client-1',
    ...overrides
  };
}

function makeQboInvoice(overrides: Partial<QboInvoiceRow> = {}): QboInvoiceRow {
  return {
    Id: 'qbo-1',
    DocNumber: 'INV-001',
    TotalAmt: 100.0,
    SyncToken: '5',
    CustomerRef: { value: 'qcust-1' },
    ...overrides
  };
}

describe('matchHistoricalInvoices', () => {
  it('confident match: DocNumber matches, total within 1 cent, unmapped customer', () => {
    const alga = [makeAlgaInvoice()];
    const qbo = [makeQboInvoice()];
    const clientMappings = new Map<string, string>();

    const { confident, review } = matchHistoricalInvoices(alga, qbo, clientMappings);
    expect(confident).toHaveLength(1);
    expect(confident[0]).toMatchObject({
      invoiceId: 'inv-1',
      externalId: 'qbo-1',
      externalDocNumber: 'INV-001',
      externalSyncToken: '5'
    });
    expect(review).toHaveLength(0);
  });

  it('confident match: mapped customer agrees with CustomerRef', () => {
    const alga = [makeAlgaInvoice({ client_id: 'client-1' })];
    const qbo = [makeQboInvoice({ CustomerRef: { value: 'qcust-1' } })];
    const clientMappings = new Map([['qcust-1', 'client-1']]);

    const { confident, review } = matchHistoricalInvoices(alga, qbo, clientMappings);
    expect(confident).toHaveLength(1);
    expect(review).toHaveLength(0);
  });

  it('doc_number_collision: multiple QBO invoices share same DocNumber → review', () => {
    const alga = [makeAlgaInvoice({ invoice_number: 'INV-DUP' })];
    const qbo = [
      makeQboInvoice({ Id: 'q1', DocNumber: 'INV-DUP' }),
      makeQboInvoice({ Id: 'q2', DocNumber: 'INV-DUP' })
    ];
    const clientMappings = new Map<string, string>();

    const { confident, review } = matchHistoricalInvoices(alga, qbo, clientMappings);
    expect(confident).toHaveLength(0);
    expect(review.length).toBeGreaterThanOrEqual(2);
    expect(review.every((r) => r.reason === 'doc_number_collision')).toBe(true);
  });

  it('total_mismatch: DocNumber matches but total differs > 1 cent → review', () => {
    const alga = [makeAlgaInvoice({ total_amount: 10000 })]; // 100.00
    const qbo = [makeQboInvoice({ TotalAmt: 99.98 })]; // 9998 cents, diff=2 cents
    const clientMappings = new Map<string, string>();

    const { confident, review } = matchHistoricalInvoices(alga, qbo, clientMappings);
    expect(confident).toHaveLength(0);
    expect(review).toHaveLength(1);
    expect(review[0].reason).toBe('total_mismatch');
  });

  it('zero matches: no matching DocNumbers', () => {
    const alga = [makeAlgaInvoice({ invoice_number: 'INV-999' })];
    const qbo = [makeQboInvoice({ DocNumber: 'INV-001' })];
    const clientMappings = new Map<string, string>();

    const { confident, review } = matchHistoricalInvoices(alga, qbo, clientMappings);
    expect(confident).toHaveLength(0);
    expect(review).toHaveLength(0);
  });

  it('customer_mismatch: CustomerRef mapped to different client → review', () => {
    const alga = [makeAlgaInvoice({ client_id: 'client-A' })];
    const qbo = [makeQboInvoice({ CustomerRef: { value: 'qcust-X' } })];
    // qcust-X is mapped to client-B, not client-A
    const clientMappings = new Map([['qcust-X', 'client-B']]);

    const { confident, review } = matchHistoricalInvoices(alga, qbo, clientMappings);
    expect(confident).toHaveLength(0);
    expect(review).toHaveLength(1);
    expect(review[0].reason).toBe('customer_mismatch');
  });
});
