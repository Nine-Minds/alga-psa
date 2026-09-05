import { describe, it, expect } from 'vitest';
import { isDialPrefixOnly, normalizePhone, splitPackedExtension } from './phone';

describe('splitPackedExtension', () => {
  it('splits the suffixes PhoneInput used to write', () => {
    expect(splitPackedExtension('+1 555 234 5678 ext. 42')).toEqual({
      number: '+1 555 234 5678',
      extension: '42'
    });
    expect(splitPackedExtension('+1 555 234 5678 x99')).toEqual({
      number: '+1 555 234 5678',
      extension: '99'
    });
    expect(splitPackedExtension('+1 555 234 5678 extension 7')).toEqual({
      number: '+1 555 234 5678',
      extension: '7'
    });
  });

  it.each(['300', '400', '500', '600'])('accepts %s as an extension', (extension) => {
    expect(splitPackedExtension(`+1 212 555 0100 ext. ${extension}`)).toEqual({
      number: '+1 212 555 0100',
      extension,
    });
  });

  it('does not extract an extension marker embedded in a number', () => {
    expect(splitPackedExtension('+1-800-NEXT.3')).toEqual({
      number: '+1-800-NEXT.3',
      extension: '',
    });
    expect(splitPackedExtension('5551234ext123')).toEqual({
      number: '5551234ext123',
      extension: '',
    });
  });

  it('leaves numbers without an extension untouched', () => {
    expect(splitPackedExtension('+1 555 234 5678')).toEqual({
      number: '+1 555 234 5678',
      extension: ''
    });
    expect(splitPackedExtension('')).toEqual({ number: '', extension: '' });
  });
});

describe('isDialPrefixOnly', () => {
  it('recognises a bare dial prefix', () => {
    expect(isDialPrefixOnly('+1')).toBe(true);
    expect(isDialPrefixOnly('+44 ')).toBe(true);
    expect(isDialPrefixOnly('+1 555')).toBe(false);
    expect(isDialPrefixOnly('')).toBe(false);
  });
});

describe('normalizePhone', () => {
  it('normalizes international input to E.164', () => {
    expect(normalizePhone('+1 (555) 234-5678')).toMatchObject({
      value: '+15552345678',
      e164: '+15552345678',
      extension: '',
      error: null
    });
  });

  it('normalizes a national number when the region is known', () => {
    expect(normalizePhone('(555) 234-5678', { defaultCountry: 'US' })).toMatchObject({
      e164: '+15552345678',
      error: null
    });
  });

  it('lifts a packed extension into its own value', () => {
    expect(normalizePhone('+1 555 234 5678 ext. 4021')).toMatchObject({
      value: '+15552345678',
      extension: '4021',
      error: null
    });
  });

  it('prefers an out-of-band extension over a packed one', () => {
    expect(normalizePhone('+1 555 234 5678 ext. 42', { extension: '99' })).toMatchObject({
      value: '+15552345678',
      extension: '99'
    });
  });

  it('treats blank and dial-prefix-only input as empty, not invalid', () => {
    expect(normalizePhone('')).toMatchObject({ value: '', error: null });
    expect(normalizePhone('   ')).toMatchObject({ value: '', error: null });
    expect(normalizePhone('+1')).toMatchObject({ value: '', error: null });
  });

  it('reports impossible numbers as a structural error', () => {
    expect(normalizePhone('+1 555').error).toBe('invalid');
    expect(normalizePhone('+1 5552345678901234567').error).toBe('invalid');
    expect(normalizePhone('not a phone').error).toBe('invalid');
  });

  it('keeps a bare national number verbatim rather than guessing a country', () => {
    const result = normalizePhone('5552345678');
    expect(result.error).toBeNull();
    expect(result.e164).toBe('');
    expect(result.value).toBe('5552345678');
  });

  it('rejects an unparseable extension', () => {
    expect(normalizePhone('+1 555 234 5678', { extension: 'abc' }).error).toBe('extensionInvalid');
    expect(normalizePhone('+1 555 234 5678', { extension: 'desk 300' }).error).toBe('extensionInvalid');
    expect(normalizePhone('+1 555 234 5678', { extension: '12345678901' }).error).toBe('extensionInvalid');
  });

  it.each(['300', '400', '500', '600'])('accepts the digit-only extension %s', (extension) => {
    expect(normalizePhone('+1 212 555 0100', { extension })).toMatchObject({
      extension,
      error: null,
    });
  });

  it('accepts possible-but-unassigned ranges (isPossible, not isValid)', () => {
    // 555-0100..0199 is reserved for fiction. It is possible, so it parses;
    // the opinion about it is a warning, not an error.
    expect(normalizePhone('+1 212 555 0123').error).toBeNull();
  });
});
