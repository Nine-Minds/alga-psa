import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  recent: undefined as unknown,
  created: [] as any[],
  whereRawArgs: [] as any[],
}));

vi.mock('@alga-psa/db', () => {
  const chain: any = {
    where: () => chain,
    whereRaw: (...args: any[]) => {
      state.whereRawArgs.push(args);
      return chain;
    },
    first: async () => state.recent,
  };
  return { tenantDb: vi.fn(() => ({ table: () => chain })) };
});

vi.mock('../models/quoteActivity', () => ({
  default: {
    create: vi.fn(async (_k: unknown, _t: string, input: any) => {
      state.created.push(input);
      return input;
    }),
  },
}));
vi.mock('../models/quote', () => ({ default: { getById: vi.fn() } }));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  resolveEmailLocale: vi.fn(async () => 'de'),
}));

import {
  PUBLIC_QUOTE_FIELDS,
  projectPublicQuote,
  projectPublicQuoteItems,
  recordQuoteViewedViaEmailLink,
} from './publicQuoteView';
import { QUOTE_ACTIVITY_TYPES } from '../lib/quoteActivityTypes';

const TOKEN = 'T'.repeat(43);

describe('public quote projection', () => {
  it('drops costs, internal notes, user ids and every non-allow-listed column', () => {
    const projected = projectPublicQuote({
      quote_id: 'q1',
      quote_number: 'Q-1',
      title: 'Title',
      status: 'sent',
      currency_code: 'EUR',
      total_amount: 1000,
      quote_date: new Date('2026-01-02T00:00:00Z'),
      cost: 5,
      internal_notes: 'secret',
      created_by: 'u1',
      accepted_by: 'u2',
      client_id: 'c1',
      contact_id: 'p1',
      tenant: 't1',
    } as any) as Record<string, unknown>;

    expect(Object.keys(projected).sort()).toEqual([...PUBLIC_QUOTE_FIELDS].sort());
    for (const leaked of ['cost', 'internal_notes', 'created_by', 'accepted_by', 'client_id', 'contact_id', 'tenant']) {
      expect(projected).not.toHaveProperty(leaked);
    }
    expect(projected.quote_date).toBe('2026-01-02T00:00:00.000Z');
    expect(JSON.stringify(projected)).not.toContain('secret');
  });

  it('projects line items without cost or catalog ids', () => {
    const [item] = projectPublicQuoteItems([
      { quote_item_id: 'i1', description: 'x', unit_price: 1, cost: 9, service_id: 's', tenant: 't' } as any,
    ]) as any[];
    expect(item).not.toHaveProperty('cost');
    expect(item).not.toHaveProperty('service_id');
    expect(item).not.toHaveProperty('tenant');
    expect(item.description).toBe('x');
  });
});

describe('recordQuoteViewedViaEmailLink', () => {
  beforeEach(() => {
    state.recent = undefined;
    state.created = [];
    state.whereRawArgs = [];
  });

  it('writes one viewed_via_email_link entry with link id and email, never the token', async () => {
    const wrote = await recordQuoteViewedViaEmailLink({} as any, 't1', {
      quoteId: 'q1',
      linkId: 'l1',
      recipientEmail: 'a@example.com',
    });
    expect(wrote).toBe(true);
    expect(state.created).toHaveLength(1);
    expect(state.created[0].activity_type).toBe(QUOTE_ACTIVITY_TYPES.viewedViaEmailLink);
    expect(state.created[0].metadata).toEqual({ link_id: 'l1', recipient_email: 'a@example.com' });
    expect(JSON.stringify(state.created[0])).not.toContain(TOKEN);
  });

  it('debounces: skips when the same link already logged a view in the last minute', async () => {
    state.recent = { activity_id: 'a1' };
    const wrote = await recordQuoteViewedViaEmailLink({} as any, 't1', {
      quoteId: 'q1',
      linkId: 'l1',
      recipientEmail: 'a@example.com',
    });
    expect(wrote).toBe(false);
    expect(state.created).toHaveLength(0);
    expect(state.whereRawArgs[0][1]).toEqual(['l1']);
  });
});
