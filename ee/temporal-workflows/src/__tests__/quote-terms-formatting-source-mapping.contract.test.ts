import { describe, expect, it } from 'vitest';
import { flattenBlockContentToPlainText } from '@alga-psa/formatting/blocknoteUtils';
import { prepareQuoteTermsForDb } from '@alga-psa/shared/lib/quoteTerms';

/**
 * Regression guard for the Temporal worker's workspace source mappings.
 *
 * The worker's Vitest configs resolve `@alga-psa/*` imports from source, not
 * from each package's built `dist/`. The shared quote-terms normalizer is pulled
 * in transitively by the workflow runtime (crmWorkerDal), and it imports
 * `@alga-psa/formatting/blocknoteUtils`. Before this suite had a source mapping
 * for `@alga-psa/formatting`, collection of every Temporal test that reached the
 * runtime failed here — either "Workspace test import requires a source mapping"
 * (dist present) or ERR_MODULE_NOT_FOUND / "Does the file exist?" (dist absent).
 * This test imports and exercises that exact module so the mapping stays wired.
 */
describe('shared quote-terms normalization resolves in the Temporal worker test env', () => {
  it('flattens structured block content and serializes the block for the DB boundary', () => {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Payment is due' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'within 30 days.' }] },
    ];

    expect(flattenBlockContentToPlainText(blocks)).toBe('Payment is due\nwithin 30 days.');

    const prepared = prepareQuoteTermsForDb({ terms_and_conditions_block: blocks });
    expect(prepared.terms_and_conditions).toBe('Payment is due\nwithin 30 days.');
    expect(JSON.parse(prepared.terms_and_conditions_block as string)[0].type).toBe('paragraph');
  });

  it('clears the structured column when the block is empty', () => {
    const prepared = prepareQuoteTermsForDb({
      terms_and_conditions_block: [],
      terms_and_conditions: 'Plain fallback',
    });

    expect(prepared.terms_and_conditions_block).toBeNull();
    expect(prepared.terms_and_conditions).toBe('Plain fallback');
  });
});
