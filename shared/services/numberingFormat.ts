/**
 * Number-format token expansion.
 *
 * Pure and dependency-free (Intl only) so the settings UI can preview exactly
 * what the server will issue, without pulling the DB stack into the browser
 * bundle — same constraint as numberingDefaults.ts.
 *
 * Phase 1 ships date tokens only. The registry plus the context bag are the
 * extension seam for non-date variables ({CLIENT}, {LOCATION}, {FISCAL_YEAR});
 * those need a per-caller fallback rule before they can be added.
 */

export type NumberTokenKind = 'date';

/** Values a template is expanded against. Grows as new token kinds land. */
export interface NumberTokenContext {
  /** Instant the number is issued at. */
  date: Date;
  /** IANA zone the instant is resolved in (the tenant's timezone at issuance). */
  timeZone: string;
}

interface ResolvedDateParts {
  year: string;
  month: string;
  day: string;
}

export interface NumberPrefixToken {
  kind: NumberTokenKind;
  description: string;
  resolve: (parts: ResolvedDateParts) => string;
}

export const NUMBER_PREFIX_TOKENS: Record<string, NumberPrefixToken> = {
  YYYY: { kind: 'date', description: 'Four-digit year', resolve: (parts) => parts.year },
  YY: { kind: 'date', description: 'Two-digit year', resolve: (parts) => parts.year.slice(-2) },
  MM: { kind: 'date', description: 'Two-digit month', resolve: (parts) => parts.month },
  DD: { kind: 'date', description: 'Two-digit day of month', resolve: (parts) => parts.day },
};

export const NUMBER_PREFIX_TOKEN_NAMES = Object.keys(NUMBER_PREFIX_TOKENS);

export interface NumberDateFormatValidation {
  valid: boolean;
  error?: string;
}

export interface ValidateNumberDateFormatOptions {
  maxExpandedLength?: number;
}

function getToken(name: string): NumberPrefixToken | undefined {
  return Object.prototype.hasOwnProperty.call(NUMBER_PREFIX_TOKENS, name)
    ? NUMBER_PREFIX_TOKENS[name]
    : undefined;
}

function tokenList(): string {
  return NUMBER_PREFIX_TOKEN_NAMES.map((name) => `{${name}}`).join(', ');
}

function resolveDateParts(date: Date, timeZone: string): ResolvedDateParts {
  const format = (zone: string): Intl.DateTimeFormatPart[] =>
    new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timeZone);
  } catch {
    // An unknown/garbled zone must never break number issuance.
    parts = format('UTC');
  }

  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: pick('year').padStart(4, '0'),
    month: pick('month'),
    day: pick('day'),
  };
}

/**
 * Replace every {TOKEN} in `template` with its value for the given instant and
 * zone. Unknown tokens are rejected at save time; here they are left verbatim
 * so a bad template is visible rather than silently altering issued numbers.
 */
export function expandDateFormat(template: string, context: NumberTokenContext): string {
  if (!template) return '';
  const parts = resolveDateParts(context.date, context.timeZone);
  return template.replace(/\{([^{}]*)\}/g, (match, name: string) => {
    const token = getToken(name);
    return token ? token.resolve(parts) : match;
  });
}

/** Length a template always expands to (every supported token is fixed width). */
export function expandedFormatLength(template: string): number {
  return expandDateFormat(template, { date: new Date(Date.UTC(2026, 0, 1)), timeZone: 'UTC' }).length;
}

export function validateNumberDateFormat(
  template: string,
  options: ValidateNumberDateFormatOptions = {},
): NumberDateFormatValidation {
  if (typeof template !== 'string') {
    return { valid: false, error: 'Date format must be a string' };
  }
  if (template === '') return { valid: true };

  if (!/^[^{}]*(\{[^{}]*\}[^{}]*)*$/.test(template)) {
    return { valid: false, error: `Date format has an unmatched { or }. Write tokens as ${tokenList()}` };
  }

  const unknown = Array.from(template.matchAll(/\{([^{}]*)\}/g))
    .map((match) => match[1])
    .filter((name) => !getToken(name));
  if (unknown.length > 0) {
    return {
      valid: false,
      error: `Unknown token${unknown.length > 1 ? 's' : ''} ${unknown.map((name) => `{${name}}`).join(', ')}. Supported tokens: ${tokenList()}`,
    };
  }

  const { maxExpandedLength } = options;
  if (typeof maxExpandedLength === 'number' && expandedFormatLength(template) > maxExpandedLength) {
    return {
      valid: false,
      error: `Date format expands to ${expandedFormatLength(template)} characters, exceeding the ${maxExpandedLength} character limit`,
    };
  }

  return { valid: true };
}
