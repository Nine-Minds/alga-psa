import { describe, expect, it } from 'vitest';

import { InvalidClientTypeError, normalizeClientType } from './normalizeClientType';

describe('normalizeClientType', () => {
  it.each([
    ['company', 'company'],
    ['Company', 'company'],
    [' COMPANY ', 'company'],
    ['individual', 'individual'],
    ['Individual', 'individual'],
    [' INDIVIDUAL ', 'individual'],
  ] as const)('normalizes %j to %j', (input, expected) => {
    expect(normalizeClientType(input)).toBe(expected);
  });

  it.each(['', '   ', null, undefined])('defaults %j to company', (input) => {
    expect(normalizeClientType(input)).toBe('company');
  });

  it.each(['Vendor', 'Customer', 42, true, {}])('rejects unsupported value %j', (input) => {
    expect(() => normalizeClientType(input)).toThrow(InvalidClientTypeError);
    expect(() => normalizeClientType(input)).toThrow("client_type must be 'company' or 'individual'");
  });
});
