import { describe, expect, it } from 'vitest';
import { ClientSchema, CreateClientSchema } from './client.schema';

describe('CreateClientSchema', () => {
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
