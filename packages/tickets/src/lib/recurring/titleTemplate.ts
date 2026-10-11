/**
 * Title tokens for recurring-ticket definitions.
 *
 *   {{client}}    the client's name
 *   {{due_date}}  the due date in long form, in the tenant's default locale
 *   {{month}}     the due date's month name, in the tenant's default locale
 *   {{year}}      the due date's year
 *
 * Unknown tokens are rejected when a definition is saved (`findUnknownTitleTokens`) so a typo can
 * never reach a generated ticket title; `renderTitleTemplate` therefore throws on one as well.
 */

export const RECURRING_TITLE_TOKENS = ['client', 'due_date', 'month', 'year'] as const;
export type RecurringTitleToken = (typeof RECURRING_TITLE_TOKENS)[number];

const TOKEN_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

const KNOWN_TOKENS: ReadonlySet<string> = new Set(RECURRING_TITLE_TOKENS);

export interface TitleTemplateContext {
  clientName: string;
  /** Due date, `YYYY-MM-DD`. */
  dueDate: string;
  /** BCP-47 locale for the date words; invalid or missing locales fall back to `en`. */
  locale?: string | null;
}

/** Tokens in `template` that are not one of {@link RECURRING_TITLE_TOKENS}, in first-seen order. */
export function findUnknownTitleTokens(template: string): string[] {
  const unknown: string[] = [];
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (!KNOWN_TOKENS.has(token) && !unknown.includes(token)) unknown.push(token);
  }
  return unknown;
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

export function renderTitleTemplate(template: string, context: TitleTemplateContext): string {
  const unknown = findUnknownTitleTokens(template);
  if (unknown.length > 0) {
    throw new Error(`Unknown title token${unknown.length > 1 ? 's' : ''}: ${unknown.map((t) => `{{${t}}}`).join(', ')}`);
  }

  const locale = resolveLocale(context.locale);
  const due = dueDateAsUtc(context.dueDate);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(due);

  const values: Record<RecurringTitleToken, () => string> = {
    client: () => context.clientName,
    due_date: () => format({ dateStyle: 'long' }),
    month: () => format({ month: 'long' }),
    year: () => format({ year: 'numeric' }),
  };

  return template.replace(TOKEN_PATTERN, (_whole, token: string) => values[token as RecurringTitleToken]());
}
