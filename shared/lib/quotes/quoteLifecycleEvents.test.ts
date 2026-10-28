import { describe, expect, it } from 'vitest';
import { QUOTE_ALLOWED_STATUS_TRANSITIONS } from '../../../packages/billing/src/schemas/quoteSchemas';
import { quoteLifecycleEventFor } from './quoteLifecycleEvents';

describe('quote lifecycle transition classification', () => {
  it('classifies every allowed status transition and suppresses unchanged statuses', () => {
    const expected: Record<string, string> = {
      sent: 'QUOTE_SENT', approved: 'QUOTE_APPROVED', accepted: 'QUOTE_ACCEPTED',
      rejected: 'QUOTE_REJECTED', expired: 'QUOTE_EXPIRED', converted: 'QUOTE_CONVERTED',
      cancelled: 'QUOTE_CANCELLED',
    };
    for (const [before, targets] of Object.entries(QUOTE_ALLOWED_STATUS_TRANSITIONS)) {
      for (const after of targets) {
        expect(quoteLifecycleEventFor(before as keyof typeof QUOTE_ALLOWED_STATUS_TRANSITIONS, after)).toBe(expected[after] ?? null);
      }
      const status = before as keyof typeof QUOTE_ALLOWED_STATUS_TRANSITIONS;
      expect(quoteLifecycleEventFor(status, status)).toBeNull();
    }
  });

  it('distinguishes system conversion reversion and revision supersession', () => {
    expect(quoteLifecycleEventFor('converted', 'accepted')).toBeNull();
    expect(quoteLifecycleEventFor('converted', 'accepted', { system: true })).toBe('QUOTE_CONVERSION_REVERTED');
    expect(quoteLifecycleEventFor('accepted', 'superseded')).toBe('QUOTE_SUPERSEDED');
    expect(quoteLifecycleEventFor(null, 'sent')).toBeNull();
  });
});
