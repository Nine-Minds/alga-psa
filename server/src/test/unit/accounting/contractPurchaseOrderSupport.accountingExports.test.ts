import { describe, it, expect } from 'vitest';

import { buildQboPrivateNoteForPurchaseOrder } from 'server/src/lib/adapters/accounting/quickBooksOnlineAdapter';
import { buildQuickBooksCsvMemo } from 'server/src/lib/adapters/accounting/quickBooksCSVAdapter';
import { buildXeroInvoiceReference } from 'server/src/lib/adapters/accounting/xeroAdapter';
import { buildXeroCsvReference } from 'server/src/lib/adapters/accounting/xeroCsvAdapter';
import { extractInvoiceIdFromReference } from 'server/src/lib/services/xeroCsvTaxImportService';

describe('Contract PO accounting export references', () => {
  it('T011: QBO API export uses PrivateNote for PO number', () => {
    expect(buildQboPrivateNoteForPurchaseOrder('PO-123')).toBe('PO: PO-123');
  });

  it('T012: QuickBooks CSV export includes PO number in Memo column', () => {
    expect(buildQuickBooksCsvMemo('inv-1', null)).toBe('Alga PSA: inv-1');
    expect(buildQuickBooksCsvMemo('inv-1', 'PO-999')).toBe('Alga PSA: inv-1 | PO PO-999');
  });

  it('T013: Xero API export includes PO number in Reference without losing invoice identifier', () => {
    expect(buildXeroInvoiceReference('INV-0001', null)).toBe('INV-0001');
    expect(buildXeroInvoiceReference('INV-0001', 'PO-123')).toBe('INV-0001 | PO PO-123');
  });

  it('T014: Xero CSV export includes PO number in Reference and tax import can recover invoice id', () => {
    const invoiceId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const reference = buildXeroCsvReference(invoiceId, 'PO-ABC');
    expect(reference).toBe(`${invoiceId} | PO PO-ABC`);
    expect(extractInvoiceIdFromReference(reference)).toBe(invoiceId);
  });
});
