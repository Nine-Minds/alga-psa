import { describe, expect, it } from 'vitest';
import { clientResponseSchema, createClientSchema } from '../../../lib/api/schemas/client';

describe('client API client_since normalization', () => {
  it('normalizes Date and ISO datetime request values', () => {
    expect(createClientSchema.parse({ client_name: 'Acme', billing_cycle: 'monthly', client_since: new Date(2021, 9, 24) }).client_since)
      .toBe('2021-10-24');
    expect(createClientSchema.parse({ client_name: 'Acme', billing_cycle: 'monthly', client_since: '2021-10-24T00:00:00Z' }).client_since)
      .toBe('2021-10-24');
  });

  it('serializes a Postgres Date response as a date-only string', () => {
    const parsed = clientResponseSchema.shape.client_since.parse(new Date(2021, 9, 24));
    expect(parsed).toBe('2021-10-24');
  });
});
