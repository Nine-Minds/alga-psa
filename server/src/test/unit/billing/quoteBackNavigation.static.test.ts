import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const quoteFormPath = path.resolve(
  process.cwd(),
  '../packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx',
);
const quoteDetailPath = path.resolve(
  process.cwd(),
  '../packages/billing/src/components/billing-dashboard/quotes/QuoteDetail.tsx',
);

describe('quote back navigation affordances', () => {
  it('shows a contract-detail-style back button on the quote form', () => {
    const source = fs.readFileSync(quoteFormPath, 'utf8');

    expect(source).toContain('id="quote-form-back-to-list"');
    expect(source).toContain('variant="soft"');
    expect(source).toContain('Back to Quotes');
    expect(source).toContain('Back to Quote Templates');
    expect(source).toContain('<ArrowLeft className="h-4 w-4" />');
  });

  it('shows a contract-detail-style back button on quote detail', () => {
    const source = fs.readFileSync(quoteDetailPath, 'utf8');

    expect(source).toContain('id="quote-detail-back"');
    expect(source).toContain('variant="soft"');
    expect(source).toContain('<ArrowLeft className="h-4 w-4" />');
  });
});
