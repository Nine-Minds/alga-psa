import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { computeDisplayOrders } = require(path.resolve(__dirname, '..', '20261009120000_service_prices_display_order.cjs'));

const TODAY = '2026-10-10';
const row = (id: string, service_id: string, currency_code: string, rate: number, effective_date = '1970-01-01') =>
  ({ price_id: id, service_id, currency_code, rate, effective_date });

describe('service_prices.display_order backfill rule (D5)', () => {
  it('the row whose rate equals default_rate is primary', () => {
    const orders = computeDisplayOrders(
      [row('a', 's1', 'EUR', 900), row('b', 's1', 'USD', 1000), row('c', 's1', 'GBP', 800)],
      new Map([['s1', 1000]]),
      'EUR',
      TODAY,
    );
    expect(orders.get('b')).toBe(0);
    // remaining rows are numbered by currency_code from 1
    expect(orders.get('a')).toBe(1);
    expect(orders.get('c')).toBe(2);
  });

  it('falls back to the tenant default currency when no rate matches', () => {
    const orders = computeDisplayOrders(
      [row('a', 's1', 'EUR', 900), row('b', 's1', 'USD', 1000)],
      new Map([['s1', 5]]),
      'USD',
      TODAY,
    );
    expect(orders.get('b')).toBe(0);
    expect(orders.get('a')).toBe(1);
  });

  it('with no match and no default-currency row, everything is numbered by currency from 1', () => {
    const orders = computeDisplayOrders(
      [row('a', 's1', 'GBP', 900), row('b', 's1', 'EUR', 1000)],
      new Map([['s1', 5]]),
      'USD',
      TODAY,
    );
    expect(orders.get('b')).toBe(1);
    expect(orders.get('a')).toBe(2);
  });

  it('orders windows independently: current vs each future date', () => {
    const orders = computeDisplayOrders(
      [
        row('c-usd', 's1', 'USD', 1000),
        row('c-eur', 's1', 'EUR', 900),
        row('f1-usd', 's1', 'USD', 1100, '2999-01-01'),
        row('f1-eur', 's1', 'EUR', 1000, '2999-01-01'),
        row('f2-usd', 's1', 'USD', 1200, '3000-01-01'),
      ],
      new Map([['s1', 1000]]),
      'USD',
      TODAY,
    );
    expect(orders.get('c-usd')).toBe(0);
    expect(orders.get('c-eur')).toBe(1);
    // future 2999: EUR rate equals default_rate, so EUR leads that window
    expect(orders.get('f1-eur')).toBe(0);
    expect(orders.get('f1-usd')).toBe(1);
    // future 3000: no match, tenant default currency leads
    expect(orders.get('f2-usd')).toBe(0);
  });

  it('superseded dated rows share the order of their currency; the current row decides the match', () => {
    const orders = computeDisplayOrders(
      [
        row('old-usd', 's1', 'USD', 500, '2020-01-01'),
        row('new-usd', 's1', 'USD', 1000, '2025-01-01'),
        row('eur', 's1', 'EUR', 900),
      ],
      new Map([['s1', 1000]]),
      'EUR',
      TODAY,
    );
    expect(orders.get('new-usd')).toBe(0);
    expect(orders.get('old-usd')).toBe(0);
    expect(orders.get('eur')).toBe(1);
  });

  it('services do not affect each other', () => {
    const orders = computeDisplayOrders(
      [row('a', 's1', 'USD', 1), row('b', 's2', 'EUR', 2), row('c', 's2', 'USD', 3)],
      { s1: 1, s2: 3 },
      null,
      TODAY,
    );
    expect(orders.get('a')).toBe(0);
    expect(orders.get('c')).toBe(0);
    expect(orders.get('b')).toBe(1);
  });
});
