import type { DescribeTranslate } from '@alga-psa/shared/lib/recurrence';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { RecurringTicketOverrides } from '../../lib/recurring/effectiveFields';

/** The message of an action result that is an error payload (the `withAuth` boundary has localized it), else null. */
export function recurringErrorMessage(result: unknown): string | null {
  if (isActionMessageError(result)) return result.actionError;
  if (isActionPermissionError(result)) return result.permissionError;
  return null;
}

/** Returns `result` or throws its error message, so callers can use one try/catch for both outcomes. */
export function unwrapRecurring<T>(result: T): T {
  const message = recurringErrorMessage(result);
  if (message !== null) throw new Error(message);
  return result;
}

/** A wall-clock instant shown in the tenant's timezone, in the viewer's locale. */
export function formatInstant(iso: string | null, locale: string, timeZone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}

/** A `YYYY-MM-DD` calendar date, formatted without any timezone shifting. */
export function formatCalendarDate(value: string | null, locale: string): string {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Adapts an i18next `t` to the shape `describeRule` expects. */
export function toDescribeTranslate(t: (key: string, options: Record<string, unknown>) => unknown): DescribeTranslate {
  return (key, options) => String(t(key, options));
}

/** Names of the overridden groups, e.g. `['board', 'priority']`; empty when the client inherits everything. */
export function overriddenGroups(overrides: RecurringTicketOverrides): Array<keyof RecurringTicketOverrides> {
  return (['board', 'priority', 'category', 'assignment'] as const).filter((group) => overrides[group] !== undefined);
}

/** `YYYY-MM-DD` to a local-midnight Date for the date field; undefined when malformed. */
export function calendarStringToDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

/** The inverse of {@link calendarStringToDate}: the local calendar day of a Date as `YYYY-MM-DD`. */
export function dateToCalendarString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The occurrence `reason` for display. The generator stores machine codes for the skip reasons
 * (`client_inactive`, `previous_open:<ticket number>`) and English free text for missed/failed
 * ones; codes are localized, free text is shown as stored.
 */
export function describeOccurrenceReason(
  reason: string | null,
  t: (key: string, defaultValue: string, options?: Record<string, unknown>) => string,
): string {
  if (!reason) return '';
  if (reason === 'client_inactive') return t('recurring.history.reasons.clientInactive', 'The client was inactive');
  const previous = /^previous_open:(.+)$/.exec(reason);
  if (previous) {
    return t('recurring.history.reasons.previousOpen', 'Ticket {{number}} from the previous occurrence is still open', {
      number: previous[1],
    });
  }
  return reason;
}

/** True when a BlockNote document has no visible content (so the definition stores `null`, not an empty paragraph). */
export function isBlankDocument(blocks: ReadonlyArray<Record<string, unknown>> | null | undefined): boolean {
  if (!blocks || blocks.length === 0) return true;
  return blocks.every((block) => {
    if (block.type !== 'paragraph') return false;
    const content = block.content;
    if (!Array.isArray(content)) return true;
    return content.every((part) => (part as { type?: string; text?: string }).type === 'text'
      && !((part as { text?: string }).text ?? '').trim());
  });
}

export interface RecurringTicketPermissions {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  /** False until the permission check has resolved. */
  loaded: boolean;
}

/** Folds a batch permission result into the four `recurring_ticket` flags; `null` means "not checked yet". */
export function permissionsFromChecks(
  results: ReadonlyArray<{ resource: string; action: string; granted: boolean }> | null,
): RecurringTicketPermissions {
  const granted = (action: string) =>
    results?.some((result) => result.resource === 'recurring_ticket' && result.action === action && result.granted) ?? false;
  return {
    read: granted('read'),
    create: granted('create'),
    update: granted('update'),
    delete: granted('delete'),
    loaded: results !== null,
  };
}
