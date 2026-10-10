import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import {
  ServiceCatalogPricingError,
  defaultRateConflictsWithPrimaryPrice,
  scheduledServicePricesInputSchema,
  servicePricesInputSchema,
  writeServiceCatalogPricing,
} from '../src/lib/catalog/serviceCatalogPricing';

const FUTURE = '2999-01-01';

// Validation runs before the lock or any row is touched, so a trx that throws on
// use proves that an invalid input never reaches the database.
const untouchableTrx = new Proxy({}, {
  get() {
    throw new Error('transaction must not be used for invalid input');
  },
}) as unknown as Knex.Transaction;

const write = (input: Parameters<typeof writeServiceCatalogPricing>[3]) =>
  writeServiceCatalogPricing(untouchableTrx, 'tenant-1', 'service-1', input);

describe('writeServiceCatalogPricing validation', () => {
  it.each([
    ['unsupported currency', { current: [{ currency_code: 'XXX', rate: 1 }] }],
    ['lowercase currency', { current: [{ currency_code: 'usd', rate: 1 }] }],
    ['duplicate currency', { current: [{ currency_code: 'USD', rate: 1 }, { currency_code: 'USD', rate: 2 }] }],
    ['fractional rate', { current: [{ currency_code: 'USD', rate: 1.5 }] }],
    ['negative rate', { current: [{ currency_code: 'USD', rate: -1 }] }],
    ['non-numeric rate', { current: [{ currency_code: 'USD', rate: 'abc' }] }],
    ['future effective_date in prices', { current: [{ currency_code: 'USD', rate: 1, effective_date: FUTURE }] }],
    ['unknown key', { current: [{ currency_code: 'USD', rate: 1, nope: 1 }] }],
    ['scheduled date not in the future', { scheduled: [{ currency_code: 'USD', rate: 1, effective_date: '2020-01-01' }] }],
    ['scheduled date malformed', { scheduled: [{ currency_code: 'USD', rate: 1, effective_date: 'soon' }] }],
    ['duplicate scheduled pair', { scheduled: [{ currency_code: 'USD', rate: 1, effective_date: FUTURE }, { currency_code: 'USD', rate: 2, effective_date: FUTURE }] }],
    ['default_rate conflicting with prices[0]', { current: [{ currency_code: 'USD', rate: 2 }], defaultRate: 1 }],
    ['fractional default_rate rewrite', { defaultRate: 10.5 }],
  ])('rejects %s before touching the database', async (_label, input) => {
    await expect(write(input as never)).rejects.toBeInstanceOf(ServiceCatalogPricingError);
  });
});

describe('shared price schemas', () => {
  it('accepts read echo fields and ignores them', () => {
    const parsed = servicePricesInputSchema.parse([
      { currency_code: 'USD', rate: 100, price_id: 'x', service_id: 'y', tenant: 't', created_at: 'a', updated_at: 'b', display_order: 3, effective_date: '1970-01-01T00:00:00.000Z' },
    ]);
    expect(parsed).toEqual([{ currency_code: 'USD', rate: 100 }]);
  });

  it('keeps array order (prices[0] is primary)', () => {
    const parsed = servicePricesInputSchema.parse([
      { currency_code: 'EUR', rate: 1 },
      { currency_code: 'USD', rate: 2 },
    ]);
    expect(parsed.map((p) => p.currency_code)).toEqual(['EUR', 'USD']);
  });

  it('accepts integer numeric strings for rate and rejects decimals', () => {
    expect(servicePricesInputSchema.parse([{ currency_code: 'USD', rate: '250' }])[0].rate).toBe(250);
    expect(servicePricesInputSchema.safeParse([{ currency_code: 'USD', rate: '2.5' }]).success).toBe(false);
  });

  it('scheduled prices carry a date after today; same currency may repeat on different dates', () => {
    const parsed = scheduledServicePricesInputSchema.parse([
      { currency_code: 'USD', rate: 1, effective_date: FUTURE },
      { currency_code: 'USD', rate: 2, effective_date: '3000-01-01' },
    ]);
    expect(parsed).toHaveLength(2);
  });

  it('D3 conflict helper', () => {
    expect(defaultRateConflictsWithPrimaryPrice(5, [{ rate: 5 }])).toBe(false);
    expect(defaultRateConflictsWithPrimaryPrice(4, [{ rate: 5 }])).toBe(true);
    expect(defaultRateConflictsWithPrimaryPrice(4, [])).toBe(false);
    expect(defaultRateConflictsWithPrimaryPrice(undefined, [{ rate: 5 }])).toBe(false);
  });
});
