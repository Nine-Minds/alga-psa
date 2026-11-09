/**
 * Settle the expiry stamp for a manual expiration. Both dates are calendar-day
 * strings (YYYY-MM-DD): keep an already-elapsed scheduled date, otherwise
 * settle at the business date the expiration takes effect on.
 *
 * The deferred-revenue rollforward keys expired blocks off `expiration_date`
 * (settling at min(expiration_date, expiry-audit date)), so an expired block
 * left with a null or future scheduled date would otherwise stay on the
 * liability through its scheduled months instead of writing off now.
 *
 * Scope: the settled date only describes an already-expired block. The nightly
 * expiration job, renewal, replenishment, balance alerts and allocation
 * eligibility all filter on status 'active' (or 'pending') first, so they never
 * act on it; time entries dated on or before the settled date can still draw
 * the block down (late entry), which is how any elapsed expiration_date
 * already behaves. A future scheduled date on an *active* block is untouched —
 * only manual expiration of an expiring-now block settles, and the original
 * date stays in the manual_expiration audit metadata
 * (`previous_expiration_date`) for reference.
 */
export function settleManualExpirationDate(currentExpiry: string | null, today: string): string {
  return !currentExpiry || currentExpiry > today ? today : currentExpiry;
}
