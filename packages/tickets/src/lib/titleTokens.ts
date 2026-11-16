/**
 * Generic `{{token}}` engine for ticket title templates. Pure: safe for the client bundle.
 *
 * Callers define their own token set (recurring tickets, batch duplicate). An unknown token is an
 * error rather than literal text, so a typo can never reach a ticket title.
 */

const TOKEN_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Tokens in `template` that are not in `known`, in first-seen order. */
export function findUnknownTokens(template: string, known: readonly string[]): string[] {
  const knownSet = new Set(known);
  const unknown: string[] = [];
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (!knownSet.has(token) && !unknown.includes(token)) unknown.push(token);
  }
  return unknown;
}

/** Every distinct token in `template`, in first-seen order. Lets a caller resolve tokens itself instead of using the throw-on-unknown {@link substituteTokens}. */
export function listTokens(template: string): string[] {
  const tokens: string[] = [];
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    if (!tokens.includes(match[1])) tokens.push(match[1]);
  }
  return tokens;
}

/** True when `template` contains at least one `{{token}}`. */
export function hasTokens(template: string): boolean {
  return new RegExp(TOKEN_PATTERN.source).test(template);
}

/** Replaces every token using `values`; throws `Unknown title token(s): …` for tokens without a value. */
export function substituteTokens(template: string, values: Record<string, () => string>): string {
  const unknown = findUnknownTokens(template, Object.keys(values));
  if (unknown.length > 0) {
    throw new Error(`Unknown title token${unknown.length > 1 ? 's' : ''}: ${unknown.map((t) => `{{${t}}}`).join(', ')}`);
  }
  return template.replace(TOKEN_PATTERN, (_whole, token: string) => values[token]());
}

/** A BCP-47 locale that this runtime supports, else `en`. */
export function resolveLocale(locale: string | null | undefined): string {
  if (!locale) return 'en';
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale])[0] ?? 'en';
  } catch {
    return 'en';
  }
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` has the `YYYY-MM-DD` shape {@link formatCalendarDate} accepts. */
export function isCalendarDate(value: string): boolean {
  return CALENDAR_DATE_PATTERN.test(value);
}

/**
 * Formats a calendar date (`YYYY-MM-DD`, no time, no zone) as floating UTC midnight, so the server's time
 * zone never shifts the day. An invalid locale falls back to `en`; a value that is not `YYYY-MM-DD` throws.
 */
export function formatCalendarDate(ymd: string, locale: string | null | undefined, style: Intl.DateTimeFormatOptions): string {
  const match = CALENDAR_DATE_PATTERN.exec(ymd);
  if (!match) throw new Error(`Invalid date "${ymd}" (expected YYYY-MM-DD)`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(resolveLocale(locale), { ...style, timeZone: 'UTC' }).format(date);
}
