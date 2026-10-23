// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { ticketUpdateSchema } from './ticket.schema';

describe('ticketUpdateSchema server-owned columns', () => {
  it('strips updated_at and updated_by sent by a client', () => {
    const parsed = ticketUpdateSchema.parse({
      title: 'Hello',
      updated_at: '2020-01-01T00:00:00.000Z',
      updated_by: '11111111-1111-4111-8111-111111111111',
    });
    expect(parsed).toEqual({ title: 'Hello' });
    expect('updated_at' in parsed).toBe(false);
    expect('updated_by' in parsed).toBe(false);
  });
});
