import { describe, expect, it } from 'vitest';
import { asPriority, pickNotificationPriority } from './priorityResolution';

describe('pickNotificationPriority (task 29.8.46 resolution chain)', () => {
  it('falls back to subtype default when no overrides exist', () => {
    expect(pickNotificationPriority(null, null, 'high')).toBe('high');
    expect(pickNotificationPriority(undefined, undefined, 'low')).toBe('low');
  });

  it('uses the tenant override over the subtype default', () => {
    expect(pickNotificationPriority(null, 'low', 'high')).toBe('low');
  });

  it("lets the user's override beat the tenant override", () => {
    expect(pickNotificationPriority('high', 'low', 'normal')).toBe('high');
  });

  it("resolves to 'normal' when nothing is configured (missing subtype)", () => {
    expect(pickNotificationPriority(null, null, null)).toBe('normal');
    expect(pickNotificationPriority(undefined, undefined, undefined)).toBe('normal');
  });

  it('ignores invalid values and continues down the chain', () => {
    expect(pickNotificationPriority('bogus', 'high', 'low')).toBe('high');
    expect(pickNotificationPriority('', '', 'low')).toBe('low');
    expect(pickNotificationPriority('critical', 'urgent', 'nope')).toBe('normal');
  });
});

describe('asPriority', () => {
  it('accepts the three valid tiers', () => {
    expect(asPriority('high')).toBe('high');
    expect(asPriority('normal')).toBe('normal');
    expect(asPriority('low')).toBe('low');
  });

  it('rejects anything else', () => {
    expect(asPriority('HIGH')).toBeNull();
    expect(asPriority('medium')).toBeNull();
    expect(asPriority(null)).toBeNull();
    expect(asPriority(undefined)).toBeNull();
    expect(asPriority(3)).toBeNull();
  });
});
