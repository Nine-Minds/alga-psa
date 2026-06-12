import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'test-tenant' })),
  withTransaction: vi.fn(async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({})),
}));

vi.mock('../builders/QueryBuilder', () => ({
  QueryBuilder: {
    validateQueryDefinition: vi.fn(),
    build: vi.fn(() => Promise.resolve([{ sum: 123456 }])),
  },
}));

import { ReportEngine } from './ReportEngine';

const definition: any = {
  id: 'test.report',
  name: 'Test Report',
  version: 1,
  category: 'test',
  metrics: [
    {
      id: 'revenue',
      query: { table: 't', aggregation: 'sum' },
      formatting: { type: 'currency', currency: 'EUR', divisor: 100 },
    },
  ],
};

describe('ReportEngine locale-aware formatting', () => {
  it('formats currency in the passed locale', async () => {
    const result = await ReportEngine.execute(definition, {}, { locale: 'de' });
    const expected = new Intl.NumberFormat('de', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234.56);
    expect(result.metrics.revenue.formatted).toBe(expected);
  });

  it('defaults to en-US when no locale is passed (backward compat)', async () => {
    const result = await ReportEngine.execute(definition, {}, {});
    const expected = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234.56);
    expect(result.metrics.revenue.formatted).toBe(expected);
  });

  it('formats number, percentage, and date per locale via formatMetricValue', () => {
    const engine = ReportEngine as any;

    const num = engine.formatMetricValue(1234567.5, { type: 'number', decimals: 1 }, 'de');
    expect(num.formatted).toBe(
      new Intl.NumberFormat('de', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1234567.5)
    );

    const pct = engine.formatMetricValue(0.42, { type: 'percentage' }, 'fr');
    expect(pct.formatted).toBe(
      new Intl.NumberFormat('fr', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(0.42)
    );

    const date = engine.formatMetricValue('2026-06-10T12:00:00Z', { type: 'date' }, 'de');
    expect(date.formatted).toBe(new Date('2026-06-10T12:00:00Z').toLocaleDateString('de'));
  });
});
