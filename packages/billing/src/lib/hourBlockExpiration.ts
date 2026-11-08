/**
 * Settlement expiry stamp for a manual expiration. Both dates are calendar-day
 * strings (YYYY-MM-DD): keep an already-elapsed scheduled date, otherwise
 * settle at today.
 *
 * The deferred-revenue rollforward keys expired blocks off `expiration_date`
 * (settling at min(expiration_date, expiry-audit date)), so an expired block
 * left with a null or future scheduled date would otherwise stay on the
 * liability through its scheduled months instead of writing off now.
 */
export function resolveManualExpirationDate(currentExpiry: string | null, today: string): string {
  return !currentExpiry || currentExpiry > today ? today : currentExpiry;
}
