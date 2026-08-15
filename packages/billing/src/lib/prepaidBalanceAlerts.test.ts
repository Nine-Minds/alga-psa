import { describe, expect, it } from 'vitest';
import {
  bucketCapacity,
  bucketDedupeKey,
  bucketPolicyChanged,
  bucketThresholdReached,
  bucketUsedPercent,
  creditDedupeKey,
  creditPolicyChanged,
  hasValidBucketCapacity,
  isCreditLow,
  normalizeRecipientKey,
} from './prepaidBalanceAlerts';

describe('isCreditLow (strict below-threshold boundary)', () => {
  it('is low only strictly below the threshold', () => {
    expect(isCreditLow({ available: 4999, hasHistory: true, threshold: 5000 })).toBe(true);
    expect(isCreditLow({ available: 0, hasHistory: true, threshold: 5000 })).toBe(true);
  });

  it('treats equality as recovery, not an alert', () => {
    expect(isCreditLow({ available: 5000, hasHistory: true, threshold: 5000 })).toBe(false);
    expect(isCreditLow({ available: 5001, hasHistory: true, threshold: 5000 })).toBe(false);
  });

  it('never alerts without credit history', () => {
    expect(isCreditLow({ available: 0, hasHistory: false, threshold: 5000 })).toBe(false);
    expect(isCreditLow({ available: 100, hasHistory: false, threshold: 5000 })).toBe(false);
  });
});

describe('bucket math (exact cross-multiplication)', () => {
  it('computes capacity as base plus rollover', () => {
    expect(bucketCapacity({ minutesUsed: 0, totalMinutes: 600, rolledOverMinutes: 120, configuredPercent: 80 })).toBe(720);
  });

  it('does not alert one unit below the exact boundary', () => {
    // capacity 1000, 80% => boundary at 800 minutes. 799 must not alert.
    const input = { minutesUsed: 799, totalMinutes: 900, rolledOverMinutes: 100, configuredPercent: 80 };
    expect(hasValidBucketCapacity(input)).toBe(true);
    expect(bucketThresholdReached(input)).toBe(false);
  });

  it('alerts at exact equality', () => {
    const input = { minutesUsed: 800, totalMinutes: 900, rolledOverMinutes: 100, configuredPercent: 80 };
    expect(bucketThresholdReached(input)).toBe(true);
  });

  it('alerts above the boundary and preserves observations above 100 percent', () => {
    const input = { minutesUsed: 1100, totalMinutes: 900, rolledOverMinutes: 100, configuredPercent: 80 };
    expect(bucketThresholdReached(input)).toBe(true);
    expect(bucketUsedPercent(input)).toBe(110);
  });

  it('skips non-positive capacity (no division by zero, no alert)', () => {
    const zeroCapacity = { minutesUsed: 500, totalMinutes: 0, rolledOverMinutes: 0, configuredPercent: 50 };
    expect(hasValidBucketCapacity(zeroCapacity)).toBe(false);
    expect(bucketThresholdReached(zeroCapacity)).toBe(false);
    expect(bucketUsedPercent(zeroCapacity)).toBe(0);

    const negativeCapacity = { minutesUsed: 500, totalMinutes: -10, rolledOverMinutes: 0, configuredPercent: 50 };
    expect(hasValidBucketCapacity(negativeCapacity)).toBe(false);
    expect(bucketThresholdReached(negativeCapacity)).toBe(false);
  });

  it('handles rollover-only capacity and 100 percent thresholds', () => {
    const rolloverOnly = { minutesUsed: 100, totalMinutes: 0, rolledOverMinutes: 100, configuredPercent: 100 };
    expect(hasValidBucketCapacity(rolloverOnly)).toBe(true);
    expect(bucketThresholdReached(rolloverOnly)).toBe(true);

    const atFullCapacity = { minutesUsed: 600, totalMinutes: 600, rolledOverMinutes: 0, configuredPercent: 100 };
    expect(bucketThresholdReached(atFullCapacity)).toBe(true);
    const belowFullCapacity = { minutesUsed: 599, totalMinutes: 600, rolledOverMinutes: 0, configuredPercent: 100 };
    expect(bucketThresholdReached(belowFullCapacity)).toBe(false);
  });

  it('uses exact integer arithmetic without rounding (no float drift)', () => {
    // 33% of 1000 capacity is exactly 330 minutes. 330 -> 33000 >= 33000 -> true.
    const input = { minutesUsed: 330, totalMinutes: 1000, rolledOverMinutes: 0, configuredPercent: 33 };
    expect(bucketThresholdReached(input)).toBe(true);
    // 329 minutes used -> 32900 < 33000 -> false.
    expect(bucketThresholdReached({ ...input, minutesUsed: 329 })).toBe(false);
  });
});

describe('dedupe keys', () => {
  it('builds stable credit keys that change with the episode', () => {
    expect(creditDedupeKey('client-1', 'USD', 1)).toBe('credit:client-1:USD:ep1');
    expect(creditDedupeKey('client-1', 'USD', 2)).toBe('credit:client-1:USD:ep2');
    expect(creditDedupeKey('client-1', 'USD', 1)).not.toBe(creditDedupeKey('client-2', 'USD', 1));
  });

  it('builds stable bucket keys per usage period and percentage', () => {
    expect(bucketDedupeKey('usage-1', 80)).toBe('bucket:usage-1:80pct');
    expect(bucketDedupeKey('usage-1', 80)).toBe(bucketDedupeKey('usage-1', 80));
    expect(bucketDedupeKey('usage-1', 80)).not.toBe(bucketDedupeKey('usage-1', 90));
    expect(bucketDedupeKey('usage-1', 80)).not.toBe(bucketDedupeKey('usage-2', 80));
  });
});

describe('policy-change detection', () => {
  it('detects credit threshold or currency changes', () => {
    expect(creditPolicyChanged({ threshold: 5000, currencyCode: 'USD' }, { threshold: 5000, currencyCode: 'USD' })).toBe(false);
    expect(creditPolicyChanged({ threshold: 5000, currencyCode: 'USD' }, { threshold: 6000, currencyCode: 'USD' })).toBe(true);
    expect(creditPolicyChanged({ threshold: 5000, currencyCode: 'USD' }, { threshold: 5000, currencyCode: 'EUR' })).toBe(true);
    expect(creditPolicyChanged(null, { threshold: 5000, currencyCode: 'USD' })).toBe(false);
  });

  it('detects bucket percentage changes', () => {
    expect(bucketPolicyChanged(80, 80)).toBe(false);
    expect(bucketPolicyChanged(80, 90)).toBe(true);
    expect(bucketPolicyChanged(null, 90)).toBe(false);
  });
});

describe('recipient key normalization', () => {
  it('trims and lowercases email addresses', () => {
    expect(normalizeRecipientKey('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(normalizeRecipientKey('BOB@example.com')).toBe('bob@example.com');
  });
});
