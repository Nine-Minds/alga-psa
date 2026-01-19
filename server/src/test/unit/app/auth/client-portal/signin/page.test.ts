import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const redirectMock = vi.fn();
const getSessionMock = vi.fn();
const isRevokedMock = vi.fn();
const getTenantBrandingByDomainMock = vi.fn();
const getTenantLocaleByDomainMock = vi.fn();

const ClientPortalSignInMock = () => null;
const ClientPortalTenantDiscoveryMock = () => null;
const PortalSwitchPromptMock = () => null;

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: getSessionMock,
}));

vi.mock('server/src/lib/models/UserSession', () => ({
  UserSession: {
    isRevoked: (...args: unknown[]) => isRevokedMock(...args),
  },
}));

vi.mock('@alga-psa/tenancy/actions', () => ({
  getTenantBrandingByDomain: getTenantBrandingByDomainMock,
  getTenantLocaleByDomain: getTenantLocaleByDomainMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/I18nWrapper', () => ({
  I18nWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@alga-psa/auth', () => ({
  ClientPortalSignIn: ClientPortalSignInMock,
  ClientPortalTenantDiscovery: ClientPortalTenantDiscoveryMock,
  PortalSwitchPrompt: PortalSwitchPromptMock,
}));

const { default: ClientPortalSignInPage } = await import('server/src/app/auth/client-portal/signin/page');

describe('ClientPortalSignInPage', () => {
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockReset();
    getSessionMock.mockReset();
    isRevokedMock.mockReset();
    getTenantBrandingByDomainMock.mockReset();
    getTenantLocaleByDomainMock.mockReset();

    if (typeof originalNextAuthUrl === 'undefined') {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    }

    getTenantBrandingByDomainMock.mockResolvedValue(null);
    getTenantLocaleByDomainMock.mockResolvedValue('es');
  });

  afterEach(() => {
    if (typeof originalNextAuthUrl === 'undefined') {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    }
  });

  it('renders tenant discovery when no tenant hint is present', async () => {
    getSessionMock.mockResolvedValue(null);

    const result = await ClientPortalSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(ClientPortalTenantDiscoveryMock);
  });

  it('redirects authenticated client portal users to the provided callback when already authenticated', async () => {
    isRevokedMock.mockResolvedValue(false);
    getSessionMock.mockResolvedValue({
      user: { id: 'user-2', user_type: 'client', tenant: 'tenant-1' },
      session_id: 'session-1',
    });

    await ClientPortalSignInPage({ searchParams: Promise.resolve({ callbackUrl: '/client-portal/tickets' }) });

    expect(redirectMock).toHaveBeenCalledWith('/client-portal/tickets');
  });

  it('renders a portal switch prompt for authenticated MSP users', async () => {
    isRevokedMock.mockResolvedValue(false);
    getSessionMock.mockResolvedValue({
      user: { id: 'user-3', user_type: 'internal', tenant: 'tenant-1', email: 'user@example.com' },
      session_id: 'session-1',
    });

    const result = await ClientPortalSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(PortalSwitchPromptMock);
  });
});
