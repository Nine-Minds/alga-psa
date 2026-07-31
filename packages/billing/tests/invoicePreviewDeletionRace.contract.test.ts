import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const querySource = readFileSync(new URL('../src/actions/invoiceQueries.ts', import.meta.url), 'utf8');
const previewSource = readFileSync(
  new URL('../src/components/billing-dashboard/invoicing/InvoicePreviewPanel.tsx', import.meta.url),
  'utf8',
);

describe('invoice preview deletion race', () => {
  it('treats a concurrently deleted invoice as the nullable reader’s normal missing result', () => {
    const reader = querySource.slice(
      querySource.indexOf('export const getEnrichedInvoiceViewModel'),
      querySource.indexOf('export const getResolvedInvoiceTemplateId'),
    );
    expect(reader).toContain("error.message === 'Invoice not found'");
    expect(reader).toContain('return null;');
  });

  it('ignores preview results after the selected invoice is cleared', () => {
    expect(previewSource).toContain('let cancelled = false;');
    expect(previewSource).toContain('if (cancelled) return;');
    expect(previewSource).toContain('cancelled = true;');
  });
});
