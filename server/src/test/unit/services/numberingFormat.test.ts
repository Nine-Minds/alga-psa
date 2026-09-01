import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NUMBER_PREFIX_TOKEN_NAMES,
  expandDateFormat,
  expandedFormatLength,
  validateNumberDateFormat,
  type NumberDateFormatErrorCode,
} from '@shared/services/numberingFormat';

const AUG_31_2026_UTC = new Date('2026-08-31T15:00:00Z');

describe('expandDateFormat', () => {
  it('expands every supported token', () => {
    const opts = { date: new Date('2026-03-07T12:00:00Z'), timeZone: 'UTC' };
    expect(expandDateFormat('{YYYY}', opts)).toBe('2026');
    expect(expandDateFormat('{YY}', opts)).toBe('26');
    expect(expandDateFormat('{MM}', opts)).toBe('03');
    expect(expandDateFormat('{DD}', opts)).toBe('07');
    expect(NUMBER_PREFIX_TOKEN_NAMES).toEqual(['YYYY', 'YY', 'MM', 'DD']);
  });

  it('keeps literals around and between tokens', () => {
    expect(expandDateFormat('FY{YY}/{MM}-', { date: AUG_31_2026_UTC, timeZone: 'UTC' })).toBe('FY26/08-');
  });

  it('returns an empty string for an empty template', () => {
    expect(expandDateFormat('', { date: AUG_31_2026_UTC, timeZone: 'UTC' })).toBe('');
  });

  it('leaves unknown tokens verbatim rather than breaking issuance', () => {
    expect(expandDateFormat('{YYY}-', { date: AUG_31_2026_UTC, timeZone: 'UTC' })).toBe('{YYY}-');
  });

  it('resolves the date in the given timezone, not UTC', () => {
    // 2026-08-31 15:00Z is already 2026-09-01 in Sydney (UTC+10): the
    // "tomorrow/yesterday" case that must not depend on the server's zone.
    expect(expandDateFormat('{YYYY}-{MM}-{DD}', { date: AUG_31_2026_UTC, timeZone: 'Australia/Sydney' }))
      .toBe('2026-09-01');
    expect(expandDateFormat('{YYYY}-{MM}-{DD}', { date: AUG_31_2026_UTC, timeZone: 'UTC' }))
      .toBe('2026-08-31');
    expect(expandDateFormat('{YYYY}-{MM}-{DD}', { date: new Date('2026-01-01T03:00:00Z'), timeZone: 'America/Los_Angeles' }))
      .toBe('2025-12-31');
  });

  it('falls back to UTC for an unusable timezone', () => {
    expect(expandDateFormat('{YYYY}-{MM}-{DD}', { date: AUG_31_2026_UTC, timeZone: 'Not/AZone' }))
      .toBe('2026-08-31');
  });
});

describe('validateNumberDateFormat', () => {
  it('accepts an empty template and well-formed templates', () => {
    expect(validateNumberDateFormat('')).toEqual({ valid: true });
    expect(validateNumberDateFormat('{YYYY}-{MM}-')).toEqual({ valid: true });
    expect(validateNumberDateFormat('no tokens at all')).toEqual({ valid: true });
  });

  it('rejects unknown tokens (typo protection)', () => {
    const result = validateNumberDateFormat('{YYY}-');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('{YYY}');
    expect(result.error).toContain('{YYYY}');
  });

  it('rejects malformed braces', () => {
    expect(validateNumberDateFormat('{YYYY').valid).toBe(false);
    expect(validateNumberDateFormat('{{YYYY}}').valid).toBe(false);
  });

  it('rejects an expansion longer than the allowed budget', () => {
    expect(validateNumberDateFormat('{YYYY}-{MM}-{DD}-', { maxExpandedLength: 10 }).valid).toBe(false);
    expect(validateNumberDateFormat('{YYYY}-{MM}-{DD}-', { maxExpandedLength: 11 })).toEqual({ valid: true });
  });

  it('measures the expanded length, not the template length', () => {
    expect(expandedFormatLength('{YYYY}-{MM}-{DD}-')).toBe(11);
  });
});

describe('date-format failures reach the admin translated', () => {
  const LOCALES_DIR = path.resolve(__dirname, '../../../../public/locales');
  const locales = fs.readdirSync(LOCALES_DIR).filter((entry) =>
    fs.statSync(path.join(LOCALES_DIR, entry)).isDirectory(),
  );

  // Every rejection the settings form can provoke, with the interpolation it
  // hands i18next. A message without its code renders as raw English.
  const failures: Array<{ code: NumberDateFormatErrorCode; params: string[]; result: ReturnType<typeof validateNumberDateFormat> }> = [
    { code: 'notText', params: [], result: validateNumberDateFormat(undefined as unknown as string) },
    { code: 'unmatchedBrace', params: ['supported'], result: validateNumberDateFormat('{YYYY') },
    { code: 'unknownToken', params: ['tokens', 'supported'], result: validateNumberDateFormat('{YYY}-') },
    { code: 'unknownTokens', params: ['tokens', 'supported'], result: validateNumberDateFormat('{YYY}-{MMM}-') },
    { code: 'tooLong', params: ['length', 'max'], result: validateNumberDateFormat('{YYYY}-{MM}-{DD}-', { maxExpandedLength: 10 }) },
  ];

  it.each(failures)('tags $code with its parameters', ({ code, params, result }) => {
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(code);
    params.forEach((param) => expect(result.errorParams).toHaveProperty(param));
  });

  it.each(locales)('%s translates every date-format failure', (locale) => {
    const pack = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, locale, 'msp/billing-settings.json'), 'utf8'),
    );
    const messages = pack.numbering?.errors?.dateFormat ?? {};

    failures.forEach(({ code, params }) => {
      const message = messages[code];
      expect(message, `${locale} is missing numbering.errors.dateFormat.${code}`).toBeTruthy();
      params.forEach((param) =>
        expect(message, `${locale} ${code} drops {{${param}}}`).toContain(`{{${param}}}`),
      );
    });
  });
});
