import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loggerError: vi.fn(), getCatalog: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.loggerError } }));
vi.mock('@alga-psa/licensing', () => ({ runWithBillingCatalogContext: (_context: unknown, work: () => unknown) => work() }));
vi.mock('../../../lib/stripe/StripeService', () => ({ getStripeService: () => ({ getOfferCatalog: mocks.getCatalog }) }));

import { loadBillingCatalogContext } from '../../../lib/stripe/offerCatalog/surfaceProbe';

describe('surface probe fails closed but visibly', () => {
  beforeEach(() => { mocks.loggerError.mockReset(); mocks.getCatalog.mockReset(); });

  it('stays closed and logs an error once per tenant with its code and message', async () => {
    mocks.getCatalog.mockRejectedValue(Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }));
    for (let i = 0; i < 3; i++) expect(await loadBillingCatalogContext('tenant-probe-1')).toMatchObject({ sellable: false, source: 'unconfigured' });
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    const line = mocks.loggerError.mock.calls[0].join(' ');
    expect(line).toContain('tenant-probe-1');
    expect(line).toContain('ECONNRESET');
    expect(line).toContain('Connection terminated unexpectedly');

    await loadBillingCatalogContext('tenant-probe-2');
    expect(mocks.loggerError).toHaveBeenCalledTimes(2);
  });

  it('does not log when the offer is legitimately not sellable', async () => {
    mocks.getCatalog.mockResolvedValue({ deploymentLivemode: async () => false,
      effectiveAccountSetting: async () => ({ stripeAccount: null, priceId: null, priceSource: 'unconfigured' }) });
    expect(await loadBillingCatalogContext('tenant-probe-3')).toMatchObject({ sellable: false });
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});
