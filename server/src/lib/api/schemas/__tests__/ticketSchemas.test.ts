import { describe, expect, it } from 'vitest';

import { ticketFilterSchema, ticketListQuerySchema } from '../ticket';

describe('ticketFilterSchema tags', () => {
  it('parses a comma-separated list into a lowercased array', () => {
    const result = ticketFilterSchema.parse({ tags: 'VIP, Urgent ,billing' });
    expect(result.tags).toEqual(['vip', 'urgent', 'billing']);
  });

  it('parses a JSON array string', () => {
    const result = ticketFilterSchema.parse({ tags: '["VIP","Urgent"]' });
    expect(result.tags).toEqual(['vip', 'urgent']);
  });

  it('accepts an array value directly', () => {
    const result = ticketFilterSchema.parse({ tags: ['VIP'] });
    expect(result.tags).toEqual(['vip']);
  });

  it('drops empty entries', () => {
    const result = ticketFilterSchema.parse({ tags: 'vip,,  ' });
    expect(result.tags).toEqual(['vip']);
  });

  it('is optional', () => {
    const result = ticketFilterSchema.parse({});
    expect(result.tags).toBeUndefined();
  });
});

describe('ticketListQuerySchema tags', () => {
  it('flows through the list query schema', () => {
    const result = ticketListQuerySchema.parse({ tags: 'VIP,urgent' }) as Record<string, unknown>;
    expect(result.tags).toEqual(['vip', 'urgent']);
  });
});
