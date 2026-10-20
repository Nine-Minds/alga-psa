/**
 * Title tokens for ticket templates (recurring schedules and Quick Add both render them).
 *
 *   {{client}}    the client's name
 *   {{contact}}   the contact's name
 *   {{due_date}}  the due date in long form, in the tenant's default locale
 *   {{month}}     the due date's month name, in the tenant's default locale
 *   {{year}}      the due date's year
 *
 * Unknown tokens are rejected when a template is saved (`findUnknownTitleTokens`) so a typo can never
 * reach a ticket title; `renderTitleTemplate` therefore throws on one as well. A token whose context is
 * missing (a manual ticket with no due date, no contact) renders as empty text and the surrounding
 * whitespace is collapsed.
 *
 * Client-safe: no server imports. The Quick Add dialog uses it directly.
 */

export const TICKET_TITLE_TOKENS = ['client', 'contact', 'due_date', 'month', 'year'] as const;
export type TicketTitleToken = (typeof TICKET_TITLE_TOKENS)[number];

const TOKEN_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

const KNOWN_TOKENS: ReadonlySet<string> = new Set(TICKET_TITLE_TOKENS);

export interface TitleTokenContext {
  clientName?: string | null;
  contactName?: string | null;
  /** Due date, `YYYY-MM-DD`. Absent for a ticket without one. */
  dueDate?: string | null;
  /** BCP-47 locale for the date words; invalid or missing locales fall back to `en`. */
  locale?: string | null;
}

/** Tokens in `template` that are not one of {@link TICKET_TITLE_TOKENS}, in first-seen order. */
export function findUnknownTitleTokens(template: string): string[] {
  const unknown: string[] = [];
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (!KNOWN_TOKENS.has(token) && !unknown.includes(token)) unknown.push(token);
  }
  return unknown;
}

/** Whether the template uses any token (known or not). */
export function titleHasTokens(template: string): boolean {
  return new RegExp(TOKEN_PATTERN.source).test(template);
}

function resolveLocale(locale: string | null | undefined): string {
  if (!locale) return 'en';
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale])[0] ?? 'en';
  } catch {
    return 'en';
  }
}

/** The due date is a calendar date, so it is formatted as floating UTC midnight: no server TZ involved. */
function dueDateAsUtc(dueDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) throw new Error(`Invalid due date "${dueDate}" (expected YYYY-MM-DD)`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function renderTitleTemplate(template: string, context: TitleTokenContext): string {
  const unknown = findUnknownTitleTokens(template);
  if (unknown.length > 0) {
    throw new Error(`Unknown title token${unknown.length > 1 ? 's' : ''}: ${unknown.map((t) => `{{${t}}}`).join(', ')}`);
  }

  const locale = resolveLocale(context.locale);
  const due = context.dueDate ? dueDateAsUtc(context.dueDate) : null;
  const format = (options: Intl.DateTimeFormatOptions) =>
    due ? new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(due) : '';

  const values: Record<TicketTitleToken, () => string> = {
    client: () => context.clientName ?? '',
    contact: () => context.contactName ?? '',
    due_date: () => format({ dateStyle: 'long' }),
    month: () => format({ month: 'long' }),
    year: () => format({ year: 'numeric' }),
  };

  let anyEmpty = false;
  const rendered = template.replace(TOKEN_PATTERN, (_whole, token: string) => {
    const value = values[token as TicketTitleToken]();
    if (value === '') anyEmpty = true;
    return value;
  });
  // Only a missing token triggers the collapse, so a title without gaps is byte-identical to its template.
  return anyEmpty ? rendered.replace(/\s+/g, ' ').trim() : rendered;
}

/**
 * Quick Add re-renders the title when client, contact or due date change, but only while the user has
 * not edited it: the title is "untouched" when it still equals what was last rendered (or is empty).
 */
export function isRenderedTitleUntouched(currentTitle: string, lastRendered: string | null): boolean {
  return currentTitle === '' || (lastRendered !== null && currentTitle === lastRendered);
}

/** A `Date` as `YYYY-MM-DD` from its local calendar parts (`toISOString` would shift the day for late-evening local times). */
export function toCalendarDate(date: Date): string {
  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/**
 * What Quick Add's re-render effect does after client, contact or due date change: the new rendered
 * title, or `null` when the template has no tokens or the user has edited the title (leave it alone).
 */
export function nextTemplateTitle(
  rawTitle: string,
  context: TitleTokenContext,
  currentTitle: string,
  lastRendered: string | null
): string | null {
  if (!titleHasTokens(rawTitle)) return null;
  if (!isRenderedTitleUntouched(currentTitle, lastRendered)) return null;
  return renderTitleTemplate(rawTitle, context);
}
