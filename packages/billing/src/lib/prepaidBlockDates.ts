import { Temporal } from '@js-temporal/polyfill';

/**
 * Prepaid Block date arithmetic (plan D6). One tested home so invoice
 * generation, finalize (which recomputes from the final invoice date) and the
 * expiry-issuance scheduler can never drift apart.
 *
 * Month addition clamps to the last day of a shorter month (Jan 31 + 1 month
 * = Feb 28/29), which is Temporal's default 'constrain' overflow.
 */

function toPlainDate(value: string | Date): Temporal.PlainDate {
  if (value instanceof Date) {
    return Temporal.PlainDate.from(value.toISOString().slice(0, 10));
  }
  // Accept ISO dates and timestamps; only the calendar date matters.
  return Temporal.PlainDate.from(value.slice(0, 10));
}

function assertExpiryMonths(expiryMonths: number): void {
  if (!Number.isInteger(expiryMonths) || expiryMonths < 1) {
    throw new Error(`expiry_months must be a positive whole number, received ${expiryMonths}`);
  }
}

/**
 * Anniversary of the invoice date: `invoice_date + expiry_months`. This is
 * when the expiry-triggered next block is due.
 */
export function computePrepaidBlockAnniversaryDate(
  invoiceDate: string | Date,
  expiryMonths: number,
): string {
  assertExpiryMonths(expiryMonths);
  return toPlainDate(invoiceDate).add({ months: expiryMonths }).toString();
}

/**
 * The block's `expiration_date` is the last usable day:
 * `invoice_date + expiry_months - 1 day`, matching the burn rule
 * `expiration_date >= workDate`. Null `expiryMonths` means the block never
 * expires.
 */
export function computePrepaidBlockExpirationDate(
  invoiceDate: string | Date,
  expiryMonths: number | null | undefined,
): string | null {
  if (expiryMonths === null || expiryMonths === undefined) return null;
  assertExpiryMonths(expiryMonths);
  return toPlainDate(invoiceDate).add({ months: expiryMonths }).subtract({ days: 1 }).toString();
}
