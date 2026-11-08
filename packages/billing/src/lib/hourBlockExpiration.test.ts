import { describe, expect, it } from 'vitest';

import { resolveManualExpirationDate } from './hourBlockExpiration';

describe('resolveManualExpirationDate', () => {
  it('settles at today when the block has no scheduled expiry', () => {
    expect(resolveManualExpirationDate(null, '2026-11-08')).toBe('2026-11-08');
  });

  it('settles at today when the scheduled expiry is still in the future', () => {
    // The portal scenario: Oct-2027 block expired by hand in Nov 2026 must
    // write off now, not linger on the liability until October.
    expect(resolveManualExpirationDate('2027-10-02', '2026-11-08')).toBe('2026-11-08');
  });

  it('keeps an already-elapsed scheduled expiry', () => {
    // The block drifted past its date unprocessed; the report already
    // projects the write-off at the scheduled day, so don't restate it.
    expect(resolveManualExpirationDate('2026-04-30', '2026-11-08')).toBe('2026-04-30');
  });

  it('keeps a scheduled expiry equal to today', () => {
    expect(resolveManualExpirationDate('2026-11-08', '2026-11-08')).toBe('2026-11-08');
  });
});
