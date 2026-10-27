import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const redirectMock = vi.fn();
const getSessionMock = vi.fn();
const isRevokedMock = vi.fn();
const cookiesMock = vi.fn();
const getTenantIdBySlugMock = vi.fn();
const getTenantDisplayNameBySlugMock = vi.fn();

const MspSignInMock = () => null;
const PortalSwitchPromptMock = () => null;
const I18nWrapperMock = ({ children }: { children?: React.ReactNode }) => children ?? null;

// Every page return is now wrapped in the i18n provider; assertions care about
// what it wraps.
const inner = (result: unknown) => (result as any)?.props?.children;

const requestLinksActionMock = vi.hoisted(() => vi.fn());
vi.mock('@/app/actions/tenantDiscoveryActions', () => ({
  requestMspSignInLinksAction: requestLinksActionMock,
  requestClientPortalLoginLinksAction: requestLinksActionMock,
}));

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@alga-psa/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@alga-psa/db', () => ({
  getTenantIdBySlug: (...args: unknown[]) => getTenantIdBySlugMock(...args),
  getTenantDisplayNameBySlug: (...args: unknown[]) => getTenantDisplayNameBySlugMock(...args),
  isValidTenantSlug: (slug: string) => /^[0-9a-f]{12}$/.test(slug),
}));

vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: {
    isRevoked: (...args: unknown[]) => isRevokedMock(...args),
  },
}));

vi.mock('@alga-psa/auth/client', () => ({
  MspSignIn: MspSignInMock,
  PortalSwitchPrompt: PortalSwitchPromptMock,
}));

// The page wraps its output in I18nWrapper so the SSO buttons and login form
// resolve their copy. Mocking the barrel also keeps @alga-psa/tenancy/server —
// which it re-exports — out of this unit test's module graph.
vi.mock('@alga-psa/tenancy/components', () => ({
  I18nWrapper: I18nWrapperMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerLocale: async () => 'en',
  getServerTranslation: async () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

const { default: MspSignInPage } = await import('server/src/app/auth/msp/signin/page');

describe('MspSignInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockReset();
    isRevokedMock.mockReset();
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => undefined),
    });
  });

  it('redirects authenticated internal users to the MSP dashboard when no callback is provided', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', user_type: 'internal' } });

    await MspSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).toHaveBeenCalledWith('/msp/dashboard');
  });

  it('redirects authenticated internal users to the provided callback when present', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-2', user_type: 'internal' } });

    await MspSignInPage({ searchParams: Promise.resolve({ callbackUrl: '/msp/tickets' }) });

    expect(redirectMock).toHaveBeenCalledWith('/msp/tickets');
  });

  it('renders a portal switch prompt for authenticated client users', async () => {
    isRevokedMock.mockResolvedValue(false);
    getSessionMock.mockResolvedValue({
      user: { id: 'user-3', user_type: 'client', tenant: 'tenant-1', email: 'client@example.com' },
      session_id: 'session-1',
    });

    const result = await MspSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(I18nWrapperMock);
    expect(inner(result)?.type).toBe(PortalSwitchPromptMock);
  });

  it('renders the sign-in component for unauthenticated users', async () => {
    getSessionMock.mockResolvedValue(null);

    const result = await MspSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(I18nWrapperMock);
    expect(inner(result)?.type).toBe(MspSignInMock);
  });

  it('T001: passes the remembered email into the shared sign-in component when the durable cookie is present', async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'msp_remembered_email' ? { value: ' remembered@example.com ' } : undefined
      ),
    });
    getSessionMock.mockResolvedValue(null);

    const result = await MspSignInPage({ searchParams: Promise.resolve({}) });

    expect(inner(result)?.type).toBe(MspSignInMock);
    expect(inner(result)?.props).toMatchObject({
      initialEmail: 'remembered@example.com',
      // The page is the injection point for the concrete server action.
      requestSignInLinks: requestLinksActionMock,
    });
  });

  it('T002: passes no initial email when the durable cookie is absent', async () => {
    getSessionMock.mockResolvedValue(null);

    const result = await MspSignInPage({ searchParams: Promise.resolve({}) });

    expect(inner(result)?.type).toBe(MspSignInMock);
    expect(inner(result)?.props.initialEmail).toBeUndefined();
  });

  describe('?tenant= scoping', () => {
    const SLUG = 'abc123def456';

    it('passes scopedTenant {slug, name} to the page for a known slug', async () => {
      getSessionMock.mockResolvedValue(null);
      getTenantIdBySlugMock.mockResolvedValue('tenant-a');
      getTenantDisplayNameBySlugMock.mockResolvedValue('Acme MSP');

      const result = await MspSignInPage({ searchParams: Promise.resolve({ tenant: SLUG }) });

      expect(redirectMock).not.toHaveBeenCalled();
      expect(inner(result)?.props.scopedTenant).toEqual({ slug: SLUG, name: 'Acme MSP' });
    });

    it('never substitutes the slug for a missing organization name', async () => {
      getSessionMock.mockResolvedValue(null);
      getTenantIdBySlugMock.mockResolvedValue('tenant-a');
      getTenantDisplayNameBySlugMock.mockResolvedValue(null);

      const result = await MspSignInPage({ searchParams: Promise.resolve({ tenant: SLUG }) });

      expect(redirectMock).not.toHaveBeenCalled();
      expect(inner(result)?.props.scopedTenant).toEqual({ slug: SLUG });
    });

    it('normalizes slug case before resolving it', async () => {
      getSessionMock.mockResolvedValue(null);
      getTenantIdBySlugMock.mockResolvedValue('tenant-a');
      getTenantDisplayNameBySlugMock.mockResolvedValue('Acme MSP');

      const result = await MspSignInPage({
        searchParams: Promise.resolve({ tenant: SLUG.toUpperCase() }),
      });

      expect(getTenantIdBySlugMock).toHaveBeenCalledWith(SLUG);
      expect(inner(result)?.props.scopedTenant.slug).toBe(SLUG);
    });

    it('redirects silently to the unscoped page, keeping callbackUrl, for a malformed slug', async () => {
      getSessionMock.mockResolvedValue(null);

      await MspSignInPage({
        searchParams: Promise.resolve({ tenant: 'not-a-slug', callbackUrl: '/msp/tickets?a=1' }),
      });

      expect(redirectMock).toHaveBeenCalledWith('/auth/msp/signin?callbackUrl=%2Fmsp%2Ftickets%3Fa%3D1');
      expect(getTenantIdBySlugMock).not.toHaveBeenCalled();
    });

    it('treats an unknown slug exactly like a malformed one and never renders a name', async () => {
      getSessionMock.mockResolvedValue(null);
      getTenantIdBySlugMock.mockResolvedValue(null);
      // next/navigation's redirect() throws; mirror that so nothing runs after it.
      redirectMock.mockImplementationOnce(() => {
        throw new Error('NEXT_REDIRECT');
      });

      await expect(MspSignInPage({ searchParams: Promise.resolve({ tenant: SLUG }) })).rejects.toThrow(
        'NEXT_REDIRECT'
      );

      expect(redirectMock).toHaveBeenCalledWith('/auth/msp/signin');
      expect(getTenantDisplayNameBySlugMock).not.toHaveBeenCalled();
    });

    it('keeps the existing redirect for a session in the same tenant', async () => {
      getSessionMock.mockResolvedValue({ user: { id: 'u', user_type: 'internal', tenant: 'tenant-a' } });
      getTenantIdBySlugMock.mockResolvedValue('tenant-a');
      getTenantDisplayNameBySlugMock.mockResolvedValue('Acme MSP');

      await MspSignInPage({ searchParams: Promise.resolve({ tenant: SLUG }) });

      expect(redirectMock).toHaveBeenCalledWith('/msp/dashboard');
    });

    it('renders the form instead of redirecting when the session belongs to a different tenant', async () => {
      getSessionMock.mockResolvedValue({ user: { id: 'u', user_type: 'internal', tenant: 'tenant-b' } });
      getTenantIdBySlugMock.mockResolvedValue('tenant-a');
      getTenantDisplayNameBySlugMock.mockResolvedValue('Acme MSP');

      const result = await MspSignInPage({ searchParams: Promise.resolve({ tenant: SLUG }) });

      expect(redirectMock).not.toHaveBeenCalled();
      expect(inner(result)?.type).toBe(MspSignInMock);
      expect(inner(result)?.props.scopedTenant).toEqual({ slug: SLUG, name: 'Acme MSP' });
    });

    it('also passes scopedTenant on the revoked-session branch', async () => {
      isRevokedMock.mockResolvedValue(true);
      getSessionMock.mockResolvedValue({
        user: { id: 'u', user_type: 'internal', tenant: 'tenant-a', email: 'x@example.com' },
        session_id: 's-1',
      });
      getTenantIdBySlugMock.mockResolvedValue('tenant-a');
      getTenantDisplayNameBySlugMock.mockResolvedValue('Acme MSP');

      const result = await MspSignInPage({ searchParams: Promise.resolve({ tenant: SLUG }) });

      expect(inner(result)?.type).toBe(MspSignInMock);
      expect(inner(result)?.props.scopedTenant).toEqual({ slug: SLUG, name: 'Acme MSP' });
    });
  });
});
