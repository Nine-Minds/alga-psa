import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readActionSource = () => readFileSync(path.resolve(__dirname, '../src/actions/quoteActions.ts'), 'utf8');

describe('billing quote authorization kernel contracts', () => {
  const source = readActionSource();

  it('T022: keeps selected quote visibility + approval mutation guards on shared kernel with bundle narrowing', () => {
    expect(source).toContain('export const getQuote = withAuth(async (');
    expect(source).toContain('export const listQuotes = withAuth(async (');
    expect(source).toContain('export const approveQuote = withAuth(async (');
    expect(source).toContain("type: 'billing'");
    expect(source).toContain("action: 'read'");
    expect(source).toContain("action: 'approve'");
    expect(source).toContain("code: 'billing_not_self_approver_denied'");
    expect(source).toContain('bundleProvider: new BundleAuthorizationKernelProvider({');
    expect(source).toContain('return await resolveBundleNarrowingRulesForEvaluation(knex, input);');
    expect(source).toContain('const mutationDecision = await authorizationKernel.authorizeMutation(mutationInput);');
  });

  it('T023: redacts configured fields on allowed quote records without changing base access decision', () => {
    // Redaction goes through the recursive record projection policy (so `quote_items.cost` reaches nested
    // lines); the shallow top-level-key helper is gone.
    expect(source).not.toContain('applyQuoteRedactions');
    expect(source).toContain('createRecordProjectionPolicy(redactedFields, QUOTE_RECORD_SOURCE)');
    expect(source).toContain('return projectQuoteRecord(quote, decision.redactedFields);');
    expect(source).toContain('const redactedRows = await Promise.all(');
    expect(source).toContain('authorizedPage.data.map(async (quote) => {');
    expect(source).toContain('return projectQuoteRecord(quote, decision.redactedFields);');
    expect(source).toContain('total: authorizedPage.total,');
  });
});
