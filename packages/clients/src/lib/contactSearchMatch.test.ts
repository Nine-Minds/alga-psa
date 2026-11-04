import { describe, expect, it } from 'vitest';
import {
  contactMatchesPhoneDigits,
  phoneDigitsMatch,
  phoneSearchDigits,
  toSearchDigits,
} from './contactSearchMatch';

describe('toSearchDigits', () => {
  it('keeps only digits', () => {
    expect(toSearchDigits('+61 433 521 762')).toBe('61433521762');
    expect(toSearchDigits('(555) 010-1 ext 9')).toBe('55501019');
    expect(toSearchDigits(null)).toBe('');
    expect(toSearchDigits(undefined)).toBe('');
  });
});

describe('phoneSearchDigits', () => {
  it('returns digits once the query has at least three of them', () => {
    expect(phoneSearchDigits('521 762')).toBe('521762');
    expect(phoneSearchDigits('762')).toBe('762');
  });

  it('declines queries that are not phone-ish', () => {
    expect(phoneSearchDigits('ad')).toBeNull();
    expect(phoneSearchDigits('unit 12')).toBeNull();
    expect(phoneSearchDigits('')).toBeNull();
  });
});

describe('phoneDigitsMatch', () => {
  it('matches partial and trailing digits regardless of formatting', () => {
    expect(phoneDigitsMatch('+61433521762', '521762')).toBe(true);
    expect(phoneDigitsMatch('+61 433 521 762', '521762')).toBe(true);
    expect(phoneDigitsMatch('+61 433 521 762', '762')).toBe(true);
    expect(phoneDigitsMatch('+61 433 521 762', '555')).toBe(false);
    expect(phoneDigitsMatch(null, '762')).toBe(false);
    expect(phoneDigitsMatch('+61433521762', '')).toBe(false);
  });
});

describe('contactMatchesPhoneDigits', () => {
  it('matches the default number and every additional number', () => {
    const contact = {
      default_phone_number: '+61 433 521 762',
      phone_numbers: [
        { phone_number: '+61 433 521 762' },
        { phone_number: '(02) 9988-7766' },
        null,
      ],
    };

    expect(contactMatchesPhoneDigits(contact, '521762')).toBe(true);
    expect(contactMatchesPhoneDigits(contact, '99887766')).toBe(true);
    expect(contactMatchesPhoneDigits(contact, '7766')).toBe(true);
    expect(contactMatchesPhoneDigits(contact, '4321')).toBe(false);
  });

  it('tolerates contacts without phone data', () => {
    expect(contactMatchesPhoneDigits({}, '762')).toBe(false);
    expect(contactMatchesPhoneDigits({ phone_numbers: null, default_phone_number: null }, '762')).toBe(false);
  });
});
