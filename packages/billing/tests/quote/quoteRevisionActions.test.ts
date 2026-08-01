// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const quoteFormSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/billing-dashboard/quotes/QuoteForm.tsx'),
  'utf8',
);
const quotesTabSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/billing-dashboard/quotes/QuotesTab.tsx'),
  'utf8',
);

describe('quote revision action wiring', () => {
  it('keeps workflow primary actions visible when quote fields are read-only', () => {
    expect(quoteFormSource).not.toContain('primaryAction && !isReadOnly');
    expect(quoteFormSource).toMatch(/case 'cancelled':[\s\S]*?id: 'quote-form-revise'/);
  });

  it('keeps Revise in the accepted quote overflow while conversions remain primary', () => {
    expect(quoteFormSource).toContain("items.push({ id: 'quote-form-revise'");
    expect(quoteFormSource).toContain('item.id !== primaryAction?.id');
  });

  it('uses the shared revisable-status contract for the quote row menu', () => {
    expect(quotesTabSource).toContain('REVISABLE_QUOTE_STATUSES.includes(status)');
    expect(quotesTabSource).toContain('createQuoteRevision(quoteId)');
    expect(quotesTabSource).toContain('onRevise={handleReviseQuote}');
    expect(quotesTabSource).toContain('quoteId=${result.quote_id}&mode=edit');
  });
});
