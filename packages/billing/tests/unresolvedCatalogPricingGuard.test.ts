import { describe, expect, it } from 'vitest';
import { UnresolvedCatalogPricingError } from '../src/lib/billing/billingEngine';

/**
 * T049/T050 boundary — the shape of the one authorised T013 carve-out (D10).
 *
 * The behaviour change is deliberately narrow: an item that is unresolved
 * *because more than one contract line covers its service* may no longer be
 * billed at catalog rate without someone saying so. An item that no contract
 * covers is untouched.
 *
 * The engine's enforcement is exercised end-to-end by the integration suite;
 * this pins the contract of the refusal itself, because a generic Error would
 * surface to the biller as a failure rather than as a decision they need to
 * make.
 */
describe('T049: catalog-pricing refusal is actionable, not a failure', () => {
  it('names the items so the biller knows what to act on', () => {
    const error = new UnresolvedCatalogPricingError(
      'A contract covers these items (Support hours, Remote support) but more than one contract line matched, ' +
        'so they cannot be billed at catalog rate. Assign a contract line to each, or explicitly choose catalog pricing for it.',
      [
        { kind: 'time_entry', id: 'entry-1', label: 'Support hours' },
        { kind: 'usage_record', id: 'usage-1', label: 'Remote support' },
      ],
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UnresolvedCatalogPricingError');
    expect(error.items).toHaveLength(2);
    // Both remedies are stated, so the message is a decision point rather than
    // a dead end.
    expect(error.message).toMatch(/assign a contract line/i);
    expect(error.message).toMatch(/explicitly choose catalog pricing/i);
    // The reason is stated in the biller's terms, not the engine's.
    expect(error.message).toMatch(/a contract covers/i);
    expect(error.message).not.toMatch(/ambiguous_or_unresolved/);
  });

  it('carries usage records and time entries alike (F141)', () => {
    const error = new UnresolvedCatalogPricingError('…', [
      { kind: 'usage_record', id: 'usage-1', label: 'Backup GB' },
    ]);
    expect(error.items[0].kind).toBe('usage_record');
  });
});
