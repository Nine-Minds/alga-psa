import { describe, expect, it, vi } from 'vitest';

const requestMock = vi.hoisted(() => vi.fn(async () => ({ success: true, message: 'generic' })));
const resolveMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth/lib/tenantDiscovery', () => ({
  CLIENT_TENANT_DISCOVERY_PROFILE: { kind: 'client-profile' },
  INTERNAL_TENANT_DISCOVERY_PROFILE: { kind: 'internal-profile' },
  requestTenantSignInLinks: requestMock,
}));
vi.mock('@alga-psa/tenancy/server', () => ({ resolveTenantAppBase: resolveMock }));
vi.mock('@alga-psa/email', () => ({ sendTenantRecoveryEmail: sendMock }));

const { requestMspSignInLinksAction, requestClientPortalLoginLinksAction } = await import(
  '../../../../app/actions/tenantDiscoveryActions'
);

describe('tenant discovery composition root', () => {
  it('binds the internal profile and the real tenancy/email collaborators for MSP', async () => {
    const result = await requestMspSignInLinksAction('a@b.com', '/msp/tickets');

    expect(requestMock).toHaveBeenCalledWith(
      { kind: 'internal-profile' },
      { resolveAppBase: resolveMock, sendRecoveryEmail: sendMock },
      'a@b.com',
      '/msp/tickets'
    );
    expect(result).toEqual({ success: true, message: 'generic' });
  });

  it('binds the client profile (contact gate, rate limit and email live in the engine) with the same collaborators', async () => {
    requestMock.mockClear();
    const result = await requestClientPortalLoginLinksAction('a@b.com');

    expect(requestMock).toHaveBeenCalledWith(
      { kind: 'client-profile' },
      { resolveAppBase: resolveMock, sendRecoveryEmail: sendMock },
      'a@b.com',
      undefined
    );
    expect(result).toEqual({ success: true, message: 'generic' });
  });
});
