import { describe, expect, it } from 'vitest';
import { computeClientAnniversary, computeDateTrigger } from '../clientDateEventBuilders';

describe('client date trigger builders', () => {
  it('returns upcoming client anniversary and handles leap day in non-leap years', () => {
    expect(computeClientAnniversary({ createdAt: '2020-02-29', now: '2025-02-27' })).toEqual({
      anniversaryDate: '2025-02-28', yearsAsClient: 5, daysUntil: 1,
    });
  });

  it('only emits configured threshold dates', () => {
    expect(computeDateTrigger('2026-01-31', '2026-01-01')).toBe(30);
    expect(computeDateTrigger('2026-01-29', '2026-01-01')).toBeNull();
  });
});
