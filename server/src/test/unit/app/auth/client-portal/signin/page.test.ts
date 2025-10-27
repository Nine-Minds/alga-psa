import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const redirectMock = vi.fn();
const getSessionMock = vi.fn();
const headersMock = vi.fn();
const getTenantBrandingByDomainMock = vi.fn();
const getTenantLocaleByDomainMock = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: getSessionMock,
}));

vi.mock('next/headers', () => ({
  headers: headersMock,
}));

vi.mock('@product/actions/tenant-actions/getTenantBrandingByDomain', () => ({
  getTenantBrandingByDomain: getTenantBrandingByDomainMock,
  getTenantLocaleByDomain: getTenantLocaleByDomainMock,
}));

vi.mock('server/src/components/i18n/I18nWrapper', () => ({
  I18nWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('server/src/components/auth/ClientPortalSignIn', () => ({
  __esModule: true,
  default: () => null,
}));

const { default: ClientPortalSignInPage } = await import('server/src/app/auth/client-portal/signin/page');

describe('ClientPortalSignInPage', () => {
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockReset();
    getSessionMock.mockReset();
    headersMock.mockReset();
    getTenantBrandingByDomainMock.mockReset();
    getTenantLocaleByDomainMock.mockReset();

    if (typeof originalNextAuthUrl === 'undefined') {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    }

    headersMock.mockResolvedValue({
      get: (key: string) => (key === 'host' ? 'vanity.example.com' : null),
    });
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

  it('redirects MSP users to the canonical MSP dashboard when already authenticated', async () => {
    process.env.NEXTAUTH_URL = 'https://auth.example.com';
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', user_type: 'internal' } });

    await ClientPortalSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).toHaveBeenCalledWith('https://auth.example.com/msp/dashboard');
  });

  it('redirects client portal users to the provided callback when already authenticated', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-2', user_type: 'client' } });

    await ClientPortalSignInPage({ searchParams: Promise.resolve({ callbackUrl: '/client-portal/tickets' }) });

    expect(redirectMock).toHaveBeenCalledWith('/client-portal/tickets');
  });

  it('throws when NEXTAUTH_URL is missing for MSP users', async () => {
    delete process.env.NEXTAUTH_URL;
    getSessionMock.mockResolvedValue({ user: { id: 'user-3', user_type: 'internal' } });

    await expect(
      ClientPortalSignInPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow('NEXTAUTH_URL must be set');

    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('throws when NEXTAUTH_URL is invalid for MSP users', async () => {
    process.env.NEXTAUTH_URL = 'not-a-valid-url';
    getSessionMock.mockResolvedValue({ user: { id: 'user-4', user_type: 'internal' } });

    await expect(
      ClientPortalSignInPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow('NEXTAUTH_URL is invalid');

    expect(redirectMock).not.toHaveBeenCalled();
  });
});
