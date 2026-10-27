import { describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn(async () => ({ success: true, message: 'generic' }));

vi.mock('@alga-psa/auth/lib/tenantDiscovery', () => ({
  CLIENT_TENANT_DISCOVERY_PROFILE: { kind: 'client-profile' },
  requestTenantSignInLinks: (...args: unknown[]) => requestMock(...(args as [])),
}));

import { requestTenantLoginLinksAction } from './tenantRecoveryActions';

describe('requestTenantLoginLinksAction', () => {
  it('delegates to the shared discovery engine with the client profile (rate limit, contact gate and email live there)', async () => {
    const result = await requestTenantLoginLinksAction('a@b.com', '/client-portal/tickets');
    expect(requestMock).toHaveBeenCalledWith({ kind: 'client-profile' }, 'a@b.com', '/client-portal/tickets');
    expect(result).toEqual({ success: true, message: 'generic' });
  });

  it('returns the engine response verbatim, including a rate-limited generic answer', async () => {
    requestMock.mockResolvedValueOnce({ success: true, message: 'generic' });
    expect(await requestTenantLoginLinksAction('a@b.com')).toEqual({ success: true, message: 'generic' });
  });
});
