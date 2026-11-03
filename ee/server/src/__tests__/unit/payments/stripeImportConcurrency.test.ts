import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@alga-psa/billing/services/invoiceBillingRecipientService', () => ({ resolveInvoiceBillingRecipient: vi.fn() }));
vi.mock('../../../lib/payments/StripePaymentProvider', () => ({ createStripePaymentProvider: vi.fn() }));

import { mapWithConcurrency, SNAPSHOT_CONCURRENCY, StripeCustomerImportService, type StripeImportGateway } from '../../../lib/payments/StripeCustomerImportService';

describe('Stripe import fan-out limit', () => {
  it('mapWithConcurrency never exceeds the limit, preserves order, and runs everything', async () => {
    let inFlight = 0; let peak = 0;
    const out = await mapWithConcurrency(Array.from({ length: 40 }, (_, i) => i), 5, async (i) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return i * 2;
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
    expect(out).toEqual(Array.from({ length: 40 }, (_, i) => i * 2));
  });

  it('preview() fetches customer snapshots through the pool (<= SNAPSHOT_CONCURRENCY at once)', async () => {
    let inFlight = 0; let peak = 0; let calls = 0;
    const gateway = {
      capabilities: () => ({ supportedCurrencies: ['USD'] }),
      getCustomerImportSnapshot: async () => { calls++; inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 2)); inFlight--; return null; },
    } as unknown as StripeImportGateway;
    const service = new StripeCustomerImportService('t', {} as any, gateway);
    vi.spyOn(service, 'loadAlgaState').mockResolvedValue({ tenantId: 't', profiles: [], mappings: [], paymentMethods: [], enrolledProfileIds: [], supportedCurrencies: ['USD'], now: new Date() } as any);

    const rows = Array.from({ length: 60 }, (_, i) => ({ rowId: `row-${i}`, clientId: 'c', billingProfileId: 'p', customerId: `cus_${i}`, source: 'mapping' as const }));
    await service.preview(rows);

    expect(calls).toBe(60);
    expect(peak).toBeLessThanOrEqual(SNAPSHOT_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });
});
