import { describe, it, expect } from 'vitest';
import {
  CLIENT_CONTACT_FIELD_LIMITS,
  clientCoreFieldsSchema,
  clientLocationCoreFieldsSchema,
  contactCoreFieldsSchema,
  parseSubmittedFields
} from './clientContact.schema';

describe('clientCoreFieldsSchema', () => {
  it('normalizes as it validates', () => {
    const parsed = clientCoreFieldsSchema.parse({
      client_name: '  Acme Corp  ',
      email: '  Info@ACME.com ',
      url: 'acme.com',
      phone_no: '+1 (555) 234-5678'
    });

    expect(parsed).toMatchObject({
      client_name: 'Acme Corp',
      email: 'info@acme.com',
      url: 'https://acme.com',
      phone_no: '+15552345678'
    });
  });

  it('treats blank optional fields as absent', () => {
    const parsed = clientCoreFieldsSchema.parse({
      client_name: 'Acme Corp',
      email: '',
      url: null,
      phone_no: '   '
    });
    expect(parsed.email).toBeUndefined();
    expect(parsed.url).toBeUndefined();
    expect(parsed.phone_no).toBeUndefined();
  });

  it('agrees with the reconciled 255-character limit', () => {
    expect(CLIENT_CONTACT_FIELD_LIMITS.clientName).toBe(255);
    expect(clientCoreFieldsSchema.safeParse({ client_name: 'A'.repeat(255) }).success).toBe(true);
    expect(clientCoreFieldsSchema.safeParse({ client_name: 'A'.repeat(256) }).success).toBe(false);
  });

  it('rejects only structural failures', () => {
    expect(clientCoreFieldsSchema.safeParse({ client_name: '' }).success).toBe(false);
    expect(clientCoreFieldsSchema.safeParse({ client_name: 'X', email: 'nope' }).success).toBe(false);
    expect(clientCoreFieldsSchema.safeParse({ client_name: 'X', url: 'not a url' }).success).toBe(false);
    expect(clientCoreFieldsSchema.safeParse({ client_name: 'X', phone_no: '+1 555' }).success).toBe(false);

    // Plausibility opinions are not structural failures.
    expect(clientCoreFieldsSchema.safeParse({ client_name: 'LLC' }).success).toBe(true);
    expect(clientCoreFieldsSchema.safeParse({ client_name: 'X', email: 'a@example.com' }).success).toBe(true);
    expect(clientCoreFieldsSchema.safeParse({ client_name: 'X', url: 'https://printer.local' }).success).toBe(true);
    expect(clientCoreFieldsSchema.safeParse({ client_name: 'X', phone_no: '+1 212 555 0123' }).success).toBe(true);
  });
});

describe('contactCoreFieldsSchema', () => {
  it('normalizes full name and email', () => {
    expect(contactCoreFieldsSchema.parse({ full_name: ' Ada Lovelace ', email: 'Ada@Example.COM ' })).toMatchObject({
      full_name: 'Ada Lovelace',
      email: 'ada@example.com'
    });
  });

  it('requires a name', () => {
    expect(contactCoreFieldsSchema.safeParse({ full_name: '  ' }).success).toBe(false);
  });
});

describe('clientLocationCoreFieldsSchema', () => {
  it('validates phone, fax and their extensions independently', () => {
    const parsed = clientLocationCoreFieldsSchema.parse({
      phone: '+1 555 234 5678',
      phone_extension: '42',
      fax: '+1 555 234 5679'
    });
    expect(parsed).toMatchObject({ phone: '+15552345678', phone_extension: '42', fax: '+15552345679' });
    expect(clientLocationCoreFieldsSchema.safeParse({ phone_extension: 'abc' }).success).toBe(false);
  });
});

describe('parseSubmittedFields', () => {
  it('validates only the keys present on the payload', () => {
    // The stored row has an unparseable email, but the caller is only renaming it.
    const result = parseSubmittedFields(clientCoreFieldsSchema, { client_name: 'Renamed Ltd' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ client_name: 'Renamed Ltd' });
  });

  it('ignores keys the schema does not own', () => {
    const result = parseSubmittedFields(clientCoreFieldsSchema, {
      client_name: 'Acme',
      notes: 'anything at all',
      credit_limit: -5
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ client_name: 'Acme' });
  });

  it('reports the offending field', () => {
    const result = parseSubmittedFields(clientCoreFieldsSchema, { email: 'nope' });
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.email).toContain('valid email');
  });

  it('preserves an explicit clear', () => {
    const result = parseSubmittedFields(clientCoreFieldsSchema, { phone_no: null, email: '' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ phone_no: null, email: '' });
  });

  it('can require the full shape for creates', () => {
    expect(parseSubmittedFields(clientCoreFieldsSchema, { email: 'a@b.com' }, { partial: false }).success).toBe(false);
    expect(parseSubmittedFields(clientCoreFieldsSchema, { client_name: 'Acme' }, { partial: false }).success).toBe(true);
  });
});
