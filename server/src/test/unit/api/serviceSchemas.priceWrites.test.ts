import { describe, expect, it } from 'vitest';
import { createServiceSchema, updateServiceSchema } from '@/lib/api/schemas/serviceSchemas';
import { createProductSchema, updateProductSchema } from '@/lib/api/schemas/productSchemas';

const TYPE_ID = '11111111-1111-4111-8111-111111111111';
const FUTURE = '2999-01-01';
const base = { service_name: 'S', custom_service_type_id: TYPE_ID, billing_method: 'fixed' as const };

describe('service schemas: price writes (alga0002016)', () => {
  it('update keeps prices and scheduled_prices instead of stripping them', () => {
    const parsed = updateServiceSchema.parse({
      prices: [{ currency_code: 'USD', rate: 100 }],
      scheduled_prices: [{ currency_code: 'USD', rate: 200, effective_date: FUTURE }],
    });
    expect(parsed.prices).toEqual([{ currency_code: 'USD', rate: 100 }]);
    expect(parsed.scheduled_prices).toEqual([{ currency_code: 'USD', rate: 200, effective_date: FUTURE }]);
  });

  it('a body with only prices is a valid update', () => {
    expect(updateServiceSchema.safeParse({ prices: [] }).success).toBe(true);
    expect(updateServiceSchema.safeParse({}).success).toBe(false);
  });

  it('rejects default_rate that differs from prices[0].rate', () => {
    expect(updateServiceSchema.safeParse({ default_rate: 1, prices: [{ currency_code: 'USD', rate: 2 }] }).success).toBe(false);
    expect(updateServiceSchema.safeParse({ default_rate: 2, prices: [{ currency_code: 'USD', rate: 2 }] }).success).toBe(true);
    expect(updateServiceSchema.safeParse({ default_rate: 1, prices: [] }).success).toBe(true);
  });

  it('rejects a top-level currency_code instead of dropping it', () => {
    const result = updateServiceSchema.safeParse({ default_rate: 1, currency_code: 'EUR' });
    expect(result.success).toBe(false);
    expect(JSON.stringify((result as any).error.issues)).toContain('prices[].currency_code');
    expect(createServiceSchema.safeParse({ ...base, default_rate: 1, currency_code: 'EUR' }).success).toBe(false);
  });

  it('create: default_rate is optional only when prices is non-empty', () => {
    expect(createServiceSchema.safeParse({ ...base, prices: [{ currency_code: 'USD', rate: 5 }] }).success).toBe(true);
    expect(createServiceSchema.safeParse({ ...base }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...base, prices: [] }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...base, default_rate: 5 }).success).toBe(true);
  });

  it('validates currencies, rates, uniqueness and dates', () => {
    const bad = (prices: unknown) => updateServiceSchema.safeParse({ prices }).success;
    expect(bad([{ currency_code: 'XXX', rate: 1 }])).toBe(false);
    expect(bad([{ currency_code: 'USD', rate: 1.5 }])).toBe(false);
    expect(bad([{ currency_code: 'USD', rate: -1 }])).toBe(false);
    expect(bad([{ currency_code: 'USD', rate: 1 }, { currency_code: 'USD', rate: 2 }])).toBe(false);
    expect(bad([{ currency_code: 'USD', rate: 1, effective_date: FUTURE }])).toBe(false);
    expect(updateServiceSchema.safeParse({ scheduled_prices: [{ currency_code: 'USD', rate: 1, effective_date: '2020-01-01' }] }).success).toBe(false);
  });

  it('products reuse the shared schema and gain scheduled_prices', () => {
    expect(createProductSchema.safeParse({ service_name: 'P', custom_service_type_id: TYPE_ID, unit_of_measure: 'each', prices: [{ currency_code: 'USD', rate: 1.5 }] }).success).toBe(false);
    const parsed = updateProductSchema.parse({ scheduled_prices: [{ currency_code: 'USD', rate: 1, effective_date: FUTURE }] });
    expect(parsed.scheduled_prices).toHaveLength(1);
  });
});
