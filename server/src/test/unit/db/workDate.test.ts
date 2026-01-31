import { describe, expect, it } from 'vitest';
import { computeWorkDateFields } from '@alga-psa/db';

describe('computeWorkDateFields', () => {
  it('computes work_date using the provided IANA timezone (edge around midnight)', () => {
    // 2026-01-01 07:30Z is 2025-12-31 23:30 in America/Los_Angeles (winter).
    const beforeMidnight = computeWorkDateFields('2026-01-01T07:30:00Z', 'America/Los_Angeles');
    expect(beforeMidnight.work_date).toBe('2025-12-31');

    // 2026-01-01 08:30Z is 2026-01-01 00:30 in America/Los_Angeles.
    const afterMidnight = computeWorkDateFields('2026-01-01T08:30:00Z', 'America/Los_Angeles');
    expect(afterMidnight.work_date).toBe('2026-01-01');
  });
});

