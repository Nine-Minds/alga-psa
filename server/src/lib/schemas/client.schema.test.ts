import { describe, expect, it } from 'vitest';
import { ClientSchema } from './client.schema';

describe('ClientSchema email representation', () => {
  const emailField = ClientSchema.pick({ email: true });

  it.each([{}, { email: null }])('accepts an email-less client representation: %o', (value) => {
    expect(emailField.safeParse(value).success).toBe(true);
  });

  it('continues to reject a malformed supplied email', () => {
    expect(emailField.safeParse({ email: 'foo@' }).success).toBe(false);
  });
});
