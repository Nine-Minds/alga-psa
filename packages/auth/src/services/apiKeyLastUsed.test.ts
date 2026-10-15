import { describe, expect, it } from 'vitest';
import { API_KEY_LAST_USED_WRITE_INTERVAL_MS, shouldTouchApiKeyLastUsed } from './apiKeyService';

describe('shouldTouchApiKeyLastUsed', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0);

  it('writes when the key has never been used', () => {
    expect(shouldTouchApiKeyLastUsed(null, now)).toBe(true);
    expect(shouldTouchApiKeyLastUsed(undefined, now)).toBe(true);
  });

  it('skips the write while the last touch is within the interval', () => {
    expect(shouldTouchApiKeyLastUsed(new Date(now - 1_000), now)).toBe(false);
    expect(shouldTouchApiKeyLastUsed(new Date(now - API_KEY_LAST_USED_WRITE_INTERVAL_MS + 1), now)).toBe(false);
  });

  it('writes once the interval has elapsed, for Date and string values', () => {
    expect(shouldTouchApiKeyLastUsed(new Date(now - API_KEY_LAST_USED_WRITE_INTERVAL_MS), now)).toBe(true);
    expect(shouldTouchApiKeyLastUsed(new Date(now - 5 * 60_000).toISOString(), now)).toBe(true);
  });

  it('writes when the stored value is unparseable', () => {
    expect(shouldTouchApiKeyLastUsed('not a date', now)).toBe(true);
  });
});
