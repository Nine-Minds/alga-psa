import { describe, expect, it } from 'vitest';
import { serializeAccountingCsv } from '../src/services/accountingCsv';
import { formatDateForQuickBooks } from '../src/adapters/accounting/quickBooksCSVAdapter';
import { formatDateForXero } from '../src/adapters/accounting/xeroCsvAdapter';

// The adapters serialize the normalized calendar fields through this same CSV
// serializer. Keep the assertion at artifact bytes so timezone regressions are
// visible in the representation users download.
describe('accounting CSV calendar date serialization', () => {
  it.each([
    [new Date('2026-09-30T00:00:00Z'), '09/30/2026'],
    ['2026-10-23', '10/23/2026'],
    ['2026-10-23T00:00:00Z', '10/23/2026'],
    [new Date('2025-12-31T00:00:00Z'), '12/31/2025'],
    ['2026-01-01T00:00:00Z', '01/01/2026']
  ])('serializes date %s without changing its calendar day', (value, expectedDate) => {
    const qbFormat = formatDateForQuickBooks(value as Date | string);
    const xeroFormat = formatDateForXero(value as Date | string);
    const csv = serializeAccountingCsv([
      { '*InvoiceDate': qbFormat, '*DueDate': qbFormat },
      { '*InvoiceDate': xeroFormat, '*DueDate': xeroFormat }
    ], ['*InvoiceDate', '*DueDate'], []);
    const [header, qbRow, xeroRow] = csv.split('\n');
    expect(header).toBe('*InvoiceDate,*DueDate');
    expect(qbRow).toBe(`${expectedDate},${expectedDate}`);
    expect(xeroRow).toBe(`${expectedDate},${expectedDate}`);
  });
});
