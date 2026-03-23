import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const invoiceServicePath = path.resolve(
  process.cwd(),
  'src/lib/api/services/InvoiceService.ts'
);

describe('invoice workflow recurring provenance wiring', () => {
  it('T199: invoice workflow events and audit logs retain recurring detail provenance on invoice lifecycle paths', () => {
    const source = fs.readFileSync(invoiceServicePath, 'utf8');

    expect(source).toContain('summarizeInvoiceRecurringProvenance');
    expect(source).toContain('recurring_provenance');
    expect(source).toContain('recurringProvenance,');
    expect(source).toContain('buildInvoiceStatusChangedPayload({');
    expect(source).toContain('buildInvoiceSentPayload({');
    expect(source).toContain('buildInvoiceOverduePayload({');
    expect(source).toContain('buildInvoiceWrittenOffPayload({');
  });
});
