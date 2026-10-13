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

import { findUnknownTokens, substituteTokens } from '../titleTokens';

export const RECURRING_TITLE_TOKENS = ['client', 'due_date', 'month', 'year'] as const;
export type RecurringTitleToken = (typeof RECURRING_TITLE_TOKENS)[number];

export interface TitleTemplateContext {
  clientName: string;
  /** Due date, `YYYY-MM-DD`. */
  dueDate: string;
  /** BCP-47 locale for the date words; invalid or missing locales fall back to `en`. */
  locale?: string | null;
}

/** Tokens in `template` that are not one of {@link RECURRING_TITLE_TOKENS}, in first-seen order. */
export function findUnknownTitleTokens(template: string): string[] {
  return findUnknownTokens(template, RECURRING_TITLE_TOKENS);
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
  const locale = resolveLocale(context.locale);
  let due: Date | undefined;
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(due);

  const values: Record<RecurringTitleToken, () => string> = {
    client: () => context.clientName,
    due_date: () => format({ dateStyle: 'long' }),
    month: () => format({ month: 'long' }),
    year: () => format({ year: 'numeric' }),
  };

  // An unknown token is reported before an invalid due date, as before; the date is then validated
  // even when the template has no tokens.
  if (findUnknownTitleTokens(template).length > 0) return substituteTokens(template, values);
  due = dueDateAsUtc(context.dueDate);
  return substituteTokens(template, values);
}
