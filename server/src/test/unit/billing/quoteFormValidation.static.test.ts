import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const quoteFormPath = path.resolve(
  process.cwd(),
  '../packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx',
);

describe('quote form validation', () => {
  it('handles missing client validation as UI state instead of throwing a console error', () => {
    const source = fs.readFileSync(quoteFormPath, 'utf8');

    expect(source).toContain("setError(t('quoteForm.validation.clientRequired'");
    expect(source).not.toContain("throw new Error(\n          t('quoteForm.validation.clientRequired'");
    expect(source).toMatch(/if \(!isTemplate && !form\.client_id\) \{\s+setError\([\s\S]*?\);\s+return;\s+\}/);
  });
});
