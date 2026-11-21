import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';

import { settleManualExpirationDate } from './hourBlockExpiration';

// Evergreen fixtures: resolve the real clock when the test runs and derive
// every date from it, so the suite stays valid as time advances.
const today = Temporal.Now.plainDateISO();

describe('settleManualExpirationDate', () => {
  it('settles at today when the block has no scheduled expiry', () => {
    expect(settleManualExpirationDate(null, today.toString())).toBe(today.toString());
  });

  it('settles at today when the scheduled expiry is still in the future', () => {
    // The portal scenario: a block expired by hand months before its
    // scheduled expiry must write off now, not linger on the liability
    // until the scheduled day.
    const futureExpiry = today.add({ months: 11 }).toString();
    expect(settleManualExpirationDate(futureExpiry, today.toString())).toBe(today.toString());
  });

  it('keeps an already-elapsed scheduled expiry', () => {
    // The block drifted past its date unprocessed; the report already
    // projects the write-off at the scheduled day, so don't restate it.
    const elapsedExpiry = today.subtract({ months: 6 }).toString();
    expect(settleManualExpirationDate(elapsedExpiry, today.toString())).toBe(elapsedExpiry);
  });

  it('keeps a scheduled expiry equal to today', () => {
    expect(settleManualExpirationDate(today.toString(), today.toString())).toBe(today.toString());
  });
});
