import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import { resolveEffectiveTimeZone } from '@alga-psa/db';

/**
 * Prepaid Block date arithmetic (plan D6). One tested home so invoice
 * generation, finalize (which recomputes from the final invoice date) and the
 * expiry-issuance scheduler can never drift apart.
 *
 * Month addition clamps to the last day of a shorter month (Jan 31 + 1 month
 * = Feb 28/29), which is Temporal's default 'constrain' overflow.
 */

/**
 * Calendar date of a JS Date read from the database, independent of the server
 * time zone. node-postgres hydrates a `date` column as LOCAL midnight, so on a
 * non-UTC server `toISOString().slice(0, 10)` is a day early east of UTC. A Date
 * that is exactly local midnight (and not UTC midnight) is a date-column value:
 * read it with local components. Anything else is a real instant or a UTC-midnight
 * date: read it in UTC.
 */
function dateObjectToDateOnly(value: Date): string {
  const isUtcMidnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0
    && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0;
  const isLocalMidnight = value.getHours() === 0 && value.getMinutes() === 0
    && value.getSeconds() === 0 && value.getMilliseconds() === 0;
  if (!isUtcMidnight && isLocalMidnight) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${String(value.getFullYear()).padStart(4, '0')}-${month}-${day}`;
  }
  return value.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of a date-only / timestamp string or a database Date; null when absent or unparseable. */
export function toDateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : dateObjectToDateOnly(value);
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Canonical UTC-midnight ISO for a date-only value. `new Date('2026-10-13')` style
 * parsing of a bare date is server-TZ dependent downstream (ensureUtcMidnightIsoDate
 * rejects it); appending the zone designator is not.
 */
// LEVERAGE: pattern date-only-to-utc-midnight — `${date}T00:00:00Z` normalizers also live in contractCadenceServicePeriodMaterialization.ts and recurringServicePeriodActions.ts; a shared date-only → UTC-midnight helper is missing.
export function dateOnlyToUtcMidnightIso(dateOnly: string): string {
  return `${dateOnly.slice(0, 10)}T00:00:00Z`;
}

/** Calendar date of an instant in the given IANA time zone. */
export function toBusinessDate(value: string | Date, timeZone: string): string {
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return Temporal.Instant.from(iso).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/**
 * THE business date for Prepaid Block invoicing: "today" (and the calendar day an
 * instant such as line.created_at falls on) in the tenant's effective time zone —
 * the same resolution the month-end eligibility gate and quote conversion use for
 * contract dates. Neither the server host's clock nor the UTC slice of a timestamp.
 * Issuance first-due dates, the Invoices listing's readiness and the billing-engine
 * "not due until" guard all derive from this one function.
 */
export async function resolvePrepaidBlockBusinessDate(
  trx: Knex | Knex.Transaction,
  tenant: string,
  at: string | Date = new Date(),
): Promise<string> {
  const timeZone = await resolveEffectiveTimeZone(trx, tenant);
  return toBusinessDate(at, timeZone);
}

function toPlainDate(value: string | Date): Temporal.PlainDate {
  if (value instanceof Date) {
    return Temporal.PlainDate.from(dateObjectToDateOnly(value));
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
