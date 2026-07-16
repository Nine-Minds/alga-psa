// Money / date helpers for the opportunities screens. Kept local and dependency-free
// so the currency formatting stays deterministic across the app and in tests.

// Currency codes conventionally rendered with a leading "$". Anything else is shown
// as "<amount> <CODE>" rather than inventing a symbol we cannot be sure of.
const DOLLAR_CODES = new Set(["USD", "CAD", "AUD", "NZD", "SGD", "HKD", "MXN"]);

export function groupThousands(value: number): string {
  const negative = value < 0;
  const digits = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${digits}` : digits;
}

/** Cents (integer) -> whole currency units, e.g. 123400 -> "$1,234" or "1,234 GBP". */
export function formatCents(cents: number, currencyCode?: string | null): string {
  const whole = Math.round(cents / 100);
  const amount = groupThousands(whole);
  const code = (currencyCode ?? "USD").trim().toUpperCase() || "USD";
  return DOLLAR_CODES.has(code) ? `$${amount}` : `${amount} ${code}`;
}

/** Locale-formatted short date, or null when the input is missing/unparseable. */
export function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Combine a calendar date with an "HH:MM" time into an ISO string, or null if incomplete. */
export function combineDateTimeIso(date: Date | undefined, hhmm: string): string | null {
  if (!date) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0).toISOString();
}
