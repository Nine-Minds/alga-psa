import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.fn();
const headersMock = vi.fn();
const getAdminConnectionMock = vi.fn();
const getPortalDomainByHostnameMock = vi.fn();

function requestHeaders(host: string) {
  return {
    get: (name: string) => name.toLowerCase() === 'host' ? host : null,
  };
}

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('next/headers', () => ({
  headers: headersMock,
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: getAdminConnectionMock,
}));

vi.mock('server/src/models/PortalDomainModel', () => ({
  getPortalDomainByHostname: getPortalDomainByHostnameMock,
}));

const { GET } = await import('../../../app/route');

describe('root route', () => {
  beforeEach(() => {
    redirectMock.mockReset();
    headersMock.mockReset();
    getAdminConnectionMock.mockReset();
    getPortalDomainByHostnameMock.mockReset();
    process.env.NEXTAUTH_URL = 'https://app.example.com';
    delete process.env.DEPLOYMENT_PROFILE;
    headersMock.mockResolvedValue(requestHeaders('portal.example.com'));
    getAdminConnectionMock.mockResolvedValue({ connection: 'admin' });
  });

  it('redirects a registered portal-domain host to the client portal', async () => {
    getPortalDomainByHostnameMock.mockResolvedValue({ id: 'portal-domain-1' });

    await GET();

    expect(redirectMock).toHaveBeenCalledWith('/client-portal');
    expect(getAdminConnectionMock).toHaveBeenCalledOnce();
    expect(getPortalDomainByHostnameMock).toHaveBeenCalledWith(
      { connection: 'admin' },
      'portal.example.com',
    );
  });

  it('keeps an unknown host on the MSP redirect', async () => {
    getPortalDomainByHostnameMock.mockResolvedValue(null);

    await GET();

    expect(redirectMock).toHaveBeenCalledWith('/msp/dashboard');
    expect(getAdminConnectionMock).toHaveBeenCalledOnce();
  });

  it('keeps the canonical host on the MSP redirect without opening an admin connection', async () => {
    headersMock.mockResolvedValue(requestHeaders('app.example.com'));

    await GET();

    expect(redirectMock).toHaveBeenCalledWith('/msp/dashboard');
    expect(getAdminConnectionMock).not.toHaveBeenCalled();
    expect(getPortalDomainByHostnameMock).not.toHaveBeenCalled();
  });
});
