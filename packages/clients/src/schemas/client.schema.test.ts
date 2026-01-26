import { describe, expect, it } from 'vitest';
import { CreateClientSchema } from './client.schema';

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

