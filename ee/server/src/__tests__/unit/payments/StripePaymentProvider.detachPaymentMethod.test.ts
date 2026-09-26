import { describe, expect, it, vi } from 'vitest';
import logger from '@alga-psa/core/logger';
import { StripePaymentProvider } from '../../../lib/payments/StripePaymentProvider';

describe('StripePaymentProvider.detachPaymentMethod', () => {
  const makeProvider = (detach: ReturnType<typeof vi.fn>) => {
    const provider = new StripePaymentProvider('tenant_1');
    (provider as any).stripe = { paymentMethods: { detach } };
    return provider;
  };

  it.each([
    ['top-level code', { code: 'resource_missing' }],
    ['raw code', { raw: { code: 'resource_missing' } }],
  ])('resolves when Stripe reports resource_missing through the %s', async (_source, error) => {
    const detach = vi.fn().mockRejectedValue(error);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(makeProvider(detach).detachPaymentMethod('pm_missing')).resolves.toBeUndefined();

    expect(detach).toHaveBeenCalledWith('pm_missing');
    expect(warn).toHaveBeenCalledWith('[StripePaymentProvider] Payment method already missing during detach', {
      tenantId: 'tenant_1',
      externalId: 'pm_missing',
    });
    warn.mockRestore();
  });

  it('still rejects Stripe errors other than resource_missing', async () => {
    const error = { code: 'card_declined' };
    const detach = vi.fn().mockRejectedValue(error);

    await expect(makeProvider(detach).detachPaymentMethod('pm_1')).rejects.toBe(error);
  });
});
