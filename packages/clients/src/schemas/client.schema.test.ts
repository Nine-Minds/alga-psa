import { describe, expect, it } from 'vitest';
import { ClientSchema, CreateClientSchema } from './client.schema';

describe('CreateClientSchema', () => {
  it('normalizes Date and ISO datetime client_since inputs', () => {
    const createSince = CreateClientSchema.pick({ client_since: true });
    const clientSince = ClientSchema.pick({ client_since: true });
    for (const schema of [createSince, clientSince]) {
      expect(schema.parse({ client_since: new Date(2021, 9, 24) }).client_since).toBe('2021-10-24');
      expect(schema.parse({ client_since: '2021-10-24T00:00:00Z' }).client_since).toBe('2021-10-24');
      expect(schema.parse({ client_since: '2021-10-24' }).client_since).toBe('2021-10-24');
      expect(schema.safeParse({ client_since: 'garbage' }).success).toBe(false);
    }
  });

  it('requires client_name', () => {
    const result = CreateClientSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts empty url/email', () => {
    const result = CreateClientSchema.safeParse({
      client_name: 'Acme Co',
      url: '',
      email: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid url', () => {
    const result = CreateClientSchema.safeParse({
      client_name: 'Acme Co',
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = CreateClientSchema.safeParse({
      client_name: 'Acme Co',
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });
});

describe('ClientSchema email representation', () => {
  const emailField = ClientSchema.pick({ email: true });

  it.each([{}, { email: null }])('accepts an email-less client representation: %o', (value) => {
    expect(emailField.safeParse(value).success).toBe(true);
  });

  it('continues to reject a malformed supplied email', () => {
    expect(emailField.safeParse({ email: 'foo@' }).success).toBe(false);
  });
});
