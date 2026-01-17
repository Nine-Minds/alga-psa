import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import type { IBillingPeriod } from 'server/src/interfaces/billing.interfaces';

vi.mock('@/lib/db/db');
vi.mock('@alga-psa/db', () => ({
  withTransaction: vi.fn(async (_knex, callback) => callback(_knex)),
  withAdminTransaction: vi.fn(async (_callback, existing) => _callback(existing)),
}));
vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(() => Promise.resolve({ user: { id: 'mock-user-id' } })),
}));
vi.mock('openid-client', () => ({
  Issuer: { discover: vi.fn() },
  Client: vi.fn(),
}));
vi.mock('jose', () => ({}));
vi.mock('server/src/lib/actions/client-actions/clientActions', () => ({
  getClientById: vi.fn(() =>
    Promise.resolve({
      client_id: 'mock-client-id',
      client_name: 'Mock Client',
      tenant: 'test_tenant',
      is_tax_exempt: false,
    })
  ),
}));

describe('BillingEngine proration ([start, end) end exclusive)', () => {
  let engine: BillingEngine;

  beforeEach(() => {
    engine = new BillingEngine();
  });

  it('returns 1.0 for a full canonical monthly period when plan is active for the full period', () => {
    const billingPeriod: IBillingPeriod = {
      startDate: '2026-01-10',
      endDate: '2026-02-10',
    };

    const factor = (engine as any)._calculateProrationFactor(
      billingPeriod,
      '2026-01-10',
      null,
      'monthly'
    ) as number;

    expect(factor).toBeCloseTo(1.0, 8);
  });

  it('prorates transition periods against canonical cycle length (Jan 1..Jan 10 => 9/31)', () => {
    const billingPeriod: IBillingPeriod = {
      startDate: '2026-01-01',
      endDate: '2026-01-10',
    };

    const factor = (engine as any)._calculateProrationFactor(
      billingPeriod,
      '2026-01-01',
      null,
      'monthly'
    ) as number;

    expect(factor).toBeCloseTo(9 / 31, 8);
  });

  it('treats plan end_date as inclusive and converts to an exclusive boundary', () => {
    const billingPeriod: IBillingPeriod = {
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    };

    // Plan is active through Jan 05 inclusive => 5 days in [start, end) terms.
    const factor = (engine as any)._calculateProrationFactor(
      billingPeriod,
      '2026-01-01',
      '2026-01-05',
      'monthly'
    ) as number;

    expect(factor).toBeCloseTo(5 / 31, 8);
  });
});

