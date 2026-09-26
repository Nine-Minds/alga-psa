import { describe, expect, it, vi } from 'vitest';
import { verifyAndCompletePublicSetup } from '@alga-psa/billing/services';
import { buildSetupSuccessUrl, createPublicSetupTenantContext, resolvePublicSetupTenantContext } from '../../../lib/payments/publicSetupConfirmation';

describe('public Stripe setup confirmation', () => {
  it('fails closed when the session tenant does not match the route tenant', async () => {
    const complete = vi.fn();
    const result = await verifyAndCompletePublicSetup('tenant-a', 'cs_1', async () => ({ tenantId: 'tenant-b', clientId: 'client', billingProfileId: 'profile', status: 'succeeded' }), complete);
    expect(result).toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });

  it('completes a verified session and delegates repeats to idempotent completeSetup', async () => {
    const inspect = vi.fn(async () => ({ tenantId: 'tenant-a', clientId: 'client', billingProfileId: 'profile', status: 'succeeded' }));
    const complete = vi.fn(async () => ({ paymentMethodId: 'pm-row' }));
    expect(await verifyAndCompletePublicSetup('tenant-a', 'cs_1', inspect, complete, 'client', 'profile')).toBe(true);
    expect(await verifyAndCompletePublicSetup('tenant-a', 'cs_1', inspect, complete, 'client', 'profile')).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('does not put an MSP return path into a success URL', () => {
    expect(buildSetupSuccessUrl('https://example.test', { tenantId: 'tenant-a', clientId: 'client', billingProfileId: 'profile' }, false, '/msp/clients/c1')).not.toContain('/msp');
  });

  it('fails before persistence when the session client or billing profile does not match the opaque context', async () => {
    const complete = vi.fn();
    const inspect = vi.fn(async () => ({ tenantId: 'tenant-a', clientId: 'other-client', billingProfileId: 'profile', status: 'succeeded' }));
    expect(await verifyAndCompletePublicSetup('tenant-a', 'cs_1', inspect, complete, 'client', 'profile')).toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps tenant context opaque in public confirmation links', () => {
    process.env.NEXTAUTH_SECRET = 'unit-test-secret';
    const token = createPublicSetupTenantContext({ tenantId: '123e4567-e89b-12d3-a456-426614174000', clientId: '123e4567-e89b-12d3-a456-426614174001', billingProfileId: '123e4567-e89b-12d3-a456-426614174002' });
    expect(token).not.toContain('123e4567');
    expect(resolvePublicSetupTenantContext(token)).toEqual({ tenantId: '123e4567-e89b-12d3-a456-426614174000', clientId: '123e4567-e89b-12d3-a456-426614174001', billingProfileId: '123e4567-e89b-12d3-a456-426614174002' });
  });
});
