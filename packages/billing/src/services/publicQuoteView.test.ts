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
  projectPublicQuoteView,
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

  it('keeps the rendered quote data and location grouping while removing every internal UUID', () => {
    const internalIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    ];
    const projected = projectPublicQuoteView({
      quote_id: internalIds[0],
      quote_number: 'Q-2026-14',
      title: 'Office network refresh',
      description: 'Replace the switching and wireless equipment.',
      quote_date: new Date('2026-04-02T00:00:00Z'),
      valid_until: new Date('2026-05-02T00:00:00Z'),
      status: 'sent',
      currency_code: 'EUR',
      subtotal: 30000,
      discount_total: 0,
      tax: 6000,
      total_amount: 36000,
      client_notes: 'Please schedule after closing.',
      terms_and_conditions: 'Payment due in 30 days.',
      terms_and_conditions_block: null,
      quote_items: [
        {
          quote_item_id: internalIds[1], quote_id: internalIds[0], location_id: internalIds[2],
          description: 'Switches', quantity: 2, unit_price: 10000, total_price: 20000,
          display_order: 0, is_optional: false, is_selected: true, is_discount: false, cost: 5,
        },
        {
          quote_item_id: internalIds[3], quote_id: internalIds[0], location_id: internalIds[2],
          description: 'Wireless access points', quantity: 2, unit_price: 5000, total_price: 10000,
          display_order: 1, is_optional: true, is_selected: false, is_discount: false, cost: 5,
        },
        {
          quote_item_id: internalIds[4], quote_id: internalIds[0], location_id: internalIds[5],
          description: 'Reception access point', quantity: 1, unit_price: 5000, total_price: 5000,
          display_order: 2, is_optional: false, is_selected: true, is_discount: false, cost: 5,
        },
      ],
    } as any, [
      {
        location_id: internalIds[2], location_name: 'Main office', address_line1: '10 Market Street',
        city: 'Boston', state_province: 'MA', postal_code: '02110', country_code: 'US', country_name: 'United States',
      },
      {
        location_id: internalIds[5], location_name: 'Reception', address_line1: '20 Market Street',
        city: 'Boston', state_province: 'MA', postal_code: '02110', country_code: 'US', country_name: 'United States',
      },
    ]);

    const serialized = JSON.stringify(projected);
    for (const internalId of internalIds) expect(serialized).not.toContain(internalId);
    expect(projected.quote).not.toHaveProperty('quote_id');
    expect(projected.items.map(({ description, publicRef, locationRef, is_optional, is_selected }) => ({
      description, publicRef, locationRef, is_optional, is_selected,
    }))).toEqual([
      { description: 'Switches', publicRef: 'item-0', locationRef: 'location-0', is_optional: false, is_selected: true },
      { description: 'Wireless access points', publicRef: 'item-1', locationRef: 'location-0', is_optional: true, is_selected: false },
      { description: 'Reception access point', publicRef: 'item-2', locationRef: 'location-1', is_optional: false, is_selected: true },
    ]);
    expect(projected.locations).toEqual([{
      publicRef: 'location-0', location_name: 'Main office', address_line1: '10 Market Street',
      address_line2: null, address_line3: null, city: 'Boston', state_province: 'MA', postal_code: '02110',
      country_code: 'US', country_name: 'United States',
    }, {
      publicRef: 'location-1', location_name: 'Reception', address_line1: '20 Market Street',
      address_line2: null, address_line3: null, city: 'Boston', state_province: 'MA', postal_code: '02110',
      country_code: 'US', country_name: 'United States',
    }]);
    expect(projected.quote).toMatchObject({
      quote_number: 'Q-2026-14', title: 'Office network refresh', currency_code: 'EUR',
      total_amount: 36000, client_notes: 'Please schedule after closing.',
    });
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
