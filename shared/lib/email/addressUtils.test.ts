import { describe, expect, it } from 'vitest';

import {
  extractEmailDomain,
  normalizeEmailAddress,
  parseEmailAddress,
  parseEmailAddressList,
} from './addressUtils';

describe('addressUtils', () => {
  it('normalizes display-name email strings', () => {
    const parsed = parseEmailAddress('  "Jane Doe" <JANE.DOE+tag@Example.COM>  ');
    expect(parsed).toEqual({
      email: 'jane.doe+tag@example.com',
      name: 'Jane Doe',
    });
  });

  it('normalizes bare and mailto addresses', () => {
    expect(normalizeEmailAddress(' MAILTO:Support@Example.com ')).toBe('support@example.com');
    expect(normalizeEmailAddress('alerts@example.com')).toBe('alerts@example.com');
  });

  it('extracts domains from sender addresses (display-name formats, uppercase emails)', () => {
    expect(extractEmailDomain('  "Jane Doe" <JANE.DOE+tag@Example.COM>  ')).toBe('example.com');
    expect(extractEmailDomain(' MAILTO:Support@Sub.Example.com ')).toBe('sub.example.com');
    expect(extractEmailDomain('alerts@example.com')).toBe('example.com');
    expect(extractEmailDomain('not an email')).toBeNull();
  });

  it('parses recipient lists with quoted commas and mixed delimiters', () => {
    const list = parseEmailAddressList('"Doe, Jane" <jane@example.com>, Support <support@example.com>;ops@example.com');
    expect(list).toEqual([
      { email: 'jane@example.com', name: 'Doe, Jane' },
      { email: 'support@example.com', name: 'Support' },
      { email: 'ops@example.com' },
    ]);
  });

  it('returns null for invalid addresses', () => {
    expect(parseEmailAddress('Not an email')).toBeNull();
    expect(normalizeEmailAddress('')).toBeNull();
  });
});
