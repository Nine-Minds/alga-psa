import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  isValidEmail,
  isValidUUID,
  isUuidShaped,
  validateArray,
  validateData,
  iso8601Schema,
  paginationSchema,
} from './utils';

describe('@alga-psa/validation utils', () => {
  it('isValidEmail validates basic email formats', () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a@b.c')).toBe(false);
    expect(isValidEmail('a@b.123')).toBe(false);
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('  a@b.com  ')).toBe(true);
  });

  it('isValidUUID validates UUID v4-ish strings', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('isUuidShaped accepts any canonical 8-4-4-4-12 hex uuid', () => {
    expect(isUuidShaped('550e8400-e29b-41d4-a716-446655440000')).toBe(true); // v4
    expect(isUuidShaped('018f4c1e-7b3a-7c2d-9e4f-0a1b2c3d4e5f')).toBe(true); // v7
    expect(isUuidShaped('00000000-0000-0000-0000-000000000001')).toBe(true);
    expect(isUuidShaped('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('isUuidShaped rejects anything Postgres could not parse as a uuid', () => {
    expect(isUuidShaped('T0001')).toBe(false);
    expect(isUuidShaped('TIC001010')).toBe(false);
    expect(isUuidShaped('')).toBe(false);
    expect(isUuidShaped(undefined)).toBe(false);
    expect(isUuidShaped(null)).toBe(false);
    expect(isUuidShaped(123)).toBe(false);
    expect(isUuidShaped({})).toBe(false);
    expect(isUuidShaped(' 550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    expect(isUuidShaped('550e8400-e29b-41d4-a716-446655440000 ')).toBe(false);
    expect(isUuidShaped('550e8400-e29b-41d4-a716-446655440000\n')).toBe(false);
    expect(isUuidShaped('{550e8400-e29b-41d4-a716-446655440000}')).toBe(false);
    expect(isUuidShaped("x' or '1'='1")).toBe(false);
    expect(isUuidShaped('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
  });

  it('validateData and validateArray delegate to zod schemas', () => {
    const schema = z.object({ id: z.string().min(1) });
    expect(validateData(schema, { id: 'x' })).toEqual({ id: 'x' });
    expect(() => validateData(schema, { id: '' })).toThrow();

    expect(validateArray(z.string().min(1), ['a', 'b'])).toEqual(['a', 'b']);
    expect(() => validateArray(z.string().min(1), ['a', ''])).toThrow();
  });

  it('iso8601Schema accepts ISO8601 strings with timezone', () => {
    expect(iso8601Schema.safeParse('2026-01-15T12:34:56Z').success).toBe(true);
    expect(iso8601Schema.safeParse('2026-01-15T12:34:56.123Z').success).toBe(true);
    expect(iso8601Schema.safeParse('2026-01-15T12:34:56').success).toBe(false);
    expect(iso8601Schema.safeParse('not-a-date').success).toBe(false);
  });

  it('paginationSchema applies defaults', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.parse({ page: 2, pageSize: 10 })).toEqual({ page: 2, pageSize: 10 });
  });
});
