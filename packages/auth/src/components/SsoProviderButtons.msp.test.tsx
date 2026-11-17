/** @vitest-environment jsdom */

import React from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const signInMock = vi.fn(async () => null);

vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

import SsoProviderButtons from './SsoProviderButtons';

const localStorageState = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => localStorageState.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageState.set(key, value);
  },
  removeItem: (key: string) => {
    localStorageState.delete(key);
  },
  clear: () => {
    localStorageState.clear();
  },
};

type ProviderId = 'google' | 'azure-ad' | 'keycloak';

function providerRegistry(ids: ProviderId[] = ['google', 'azure-ad', 'keycloak']) {
  return Object.fromEntries(ids.map((id) => [id, { id, type: 'oidc' }]));
}

function buildFetchMock(options: {
  discoverProviders: ProviderId[];
  registeredProviders?: ProviderId[];
  resolveOk?: boolean;
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === '/api/auth/providers') {
      return {
        ok: true,
        json: async () => providerRegistry(options.registeredProviders),
      };
    }

    if (url === '/api/auth/msp/sso/discover') {
      return {
        ok: true,
        json: async () => ({ ok: true, providers: options.discoverProviders }),
      };
    }

    if (url === '/api/auth/msp/sso/resolve') {
      return {
        ok: options.resolveOk ?? true,
        json: async () => ({ ok: options.resolveOk ?? true }),
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });
}

const savedEdition = process.env.NEXT_PUBLIC_EDITION;

describe('MSP SSO provider buttons', () => {
  afterAll(() => {
    if (savedEdition === undefined) delete process.env.NEXT_PUBLIC_EDITION;
    else process.env.NEXT_PUBLIC_EDITION = savedEdition;
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    vi.clearAllMocks();
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
  });

  it('T031: remains disabled for empty or invalid email input', () => {
    const fetchMock = buildFetchMock({ discoverProviders: ['google', 'azure-ad'] });
    vi.stubGlobal('fetch', fetchMock as any);

    const { rerender } = render(<SsoProviderButtons callbackUrl="/msp" email="   " />);

    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/msp/sso/discover', expect.anything());

    rerender(<SsoProviderButtons callbackUrl="/msp" email="not-an-email" />);

    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/msp/sso/discover', expect.anything());
  });

  it('T032: remains disabled while discovery request is in flight', async () => {
    let resolveDiscovery: ((value: unknown) => void) | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/providers') {
        return { ok: true, json: async () => providerRegistry() };
      }
      if (String(input) !== '/api/auth/msp/sso/discover') {
        throw new Error(`Unexpected URL: ${String(input)}`);
      }
      return await new Promise((resolve) => {
        resolveDiscovery = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/msp/sso/discover',
      expect.objectContaining({ method: 'POST' })
    ));
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeDisabled();

    resolveDiscovery?.({
      ok: true,
      json: async () => ({ ok: true, providers: ['google'] }),
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' })).not.toBeDisabled());
  });

  it('T033: enables only Microsoft when discovery returns azure-ad', async () => {
    const fetchMock = buildFetchMock({ discoverProviders: ['azure-ad'] });
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).not.toBeDisabled());
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
  });

  it('T034: enables both providers when discovery returns both', async () => {
    const fetchMock = buildFetchMock({ discoverProviders: ['google', 'azure-ad'] });
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' })).not.toBeDisabled());
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).not.toBeDisabled();
  });

  it('T035/T038: keeps unsupported providers disabled and blocked from resolver call', async () => {
    const fetchMock = buildFetchMock({ discoverProviders: ['google'] });
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' })).not.toBeDisabled());

    const microsoftButton = screen.getByRole('button', { name: 'Sign in with Microsoft' });
    expect(microsoftButton).toBeDisabled();

    fireEvent.click(microsoftButton);

    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/auth/msp/sso/discover')).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/auth/msp/sso/resolve',
      expect.anything()
    );
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('T036: persists last selected provider locally after successful resolver start', async () => {
    const fetchMock = buildFetchMock({ discoverProviders: ['google', 'azure-ad'] });
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/dashboard" email="admin@example.com" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith(
      'azure-ad',
      { callbackUrl: '/dashboard' },
      expect.objectContaining({ state: expect.any(String) })
    ));
    const authorizationParams = signInMock.mock.calls[0]?.[2] as { state?: string };
    expect(JSON.parse(authorizationParams.state || '{}')).toMatchObject({
      callback_url: '/dashboard',
    });

    expect(window.localStorage.getItem('msp_sso_last_provider')).toBe('azure-ad');
  });

  it('T021: a prefilled remembered email triggers SSO discovery and resolver payload includes public-workstation state', async () => {
    const fetchMock = buildFetchMock({ discoverProviders: ['google', 'azure-ad'] });
    vi.stubGlobal('fetch', fetchMock as any);

    render(
      <SsoProviderButtons
        callbackUrl="/msp"
        email="Remembered@example.com"
        publicWorkstation={true}
      />
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/msp/sso/discover',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'remembered@example.com',
            callbackUrl: '/msp',
          }),
        })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/msp/sso/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            provider: 'google',
            email: 'remembered@example.com',
            publicWorkstation: true,
            callbackUrl: '/msp',
          }),
        })
      )
    );
  });

  it('renders a Keycloak button that follows discovery and starts the keycloak provider', async () => {
    const fetchMock = buildFetchMock({ discoverProviders: ['keycloak'] });
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    const keycloakButton = await screen.findByRole('button', { name: 'Sign in with Keycloak' });
    await waitFor(() => expect(keycloakButton).not.toBeDisabled());
    expect(keycloakButton.querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeDisabled();

    fireEvent.click(keycloakButton);

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith(
      'keycloak',
      { callbackUrl: '/msp' },
      expect.objectContaining({ state: expect.any(String) })
    ));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/msp/sso/resolve',
      expect.objectContaining({
        body: JSON.stringify({
          provider: 'keycloak',
          email: 'user@example.com',
          publicWorkstation: false,
          callbackUrl: '/msp',
        }),
      })
    );
    expect(window.localStorage.getItem('msp_sso_last_provider')).toBe('keycloak');
  });

  it('hides providers NextAuth has not registered, so unconfigured providers never render a dead button', async () => {
    const fetchMock = buildFetchMock({ discoverProviders: ['google'], registeredProviders: ['google', 'credentials' as ProviderId] });
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' })).not.toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in with Keycloak' })).toBeNull();
  });

  it('shows a tenant-configured provider that discovery offers even though NextAuth has not registered it app-wide', async () => {
    const fetchMock = buildFetchMock({ discoverProviders: ['keycloak'], registeredProviders: ['google', 'credentials' as ProviderId] });
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    const keycloakButton = await screen.findByRole('button', { name: 'Sign in with Keycloak' });
    await waitFor(() => expect(keycloakButton).not.toBeDisabled());
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull();
  });

  it('renders nothing on CE when Keycloak is neither registered nor discovered', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    const fetchMock = buildFetchMock({ discoverProviders: [], registeredProviders: ['credentials' as ProviderId] });
    vi.stubGlobal('fetch', fetchMock as any);

    const { container } = render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/msp/sso/discover', expect.anything()));
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('Community Edition renders only the Keycloak button and stacks buttons full-width', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    const fetchMock = buildFetchMock({ discoverProviders: ['keycloak'] });
    vi.stubGlobal('fetch', fetchMock as any);

    const { container } = render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    const keycloakButton = await screen.findByRole('button', { name: 'Sign in with Keycloak' });
    await waitFor(() => expect(keycloakButton).not.toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull();
    expect(container.firstElementChild?.className).toContain('flex-col');
    expect(keycloakButton.className).toContain('w-full');
  });

  it('Community Edition client portal renders no SSO buttons and skips discovery', () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    const fetchMock = buildFetchMock({ discoverProviders: ['keycloak'] });
    vi.stubGlobal('fetch', fetchMock as any);

    const { container } = render(
      <SsoProviderButtons callbackUrl="/client-portal" email="user@example.com" authSurface="client_portal" />
    );

    expect(container.innerHTML).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('T037: remembered provider is preselected only when still eligible', async () => {
    window.localStorage.setItem('msp_sso_last_provider', 'google');

    const fetchEligible = buildFetchMock({ discoverProviders: ['google', 'azure-ad'] });
    vi.stubGlobal('fetch', fetchEligible as any);

    const { rerender } = render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' })).not.toBeDisabled());
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toHaveAttribute('data-preferred', 'true');

    const fetchIneligible = buildFetchMock({ discoverProviders: ['azure-ad'] });
    vi.stubGlobal('fetch', fetchIneligible as any);
    rerender(<SsoProviderButtons callbackUrl="/msp" email="user@acme.com" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).not.toBeDisabled());
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toHaveAttribute('data-preferred', 'false');
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toHaveAttribute('data-preferred', 'false');
  });

  // F001 / F004 (alga-2026-0002996)
  describe('on a custom domain', () => {
    const CANONICAL = 'https://app.alga.test';

    function stubLocation(origin: string, host: string) {
      const assign = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { origin, host, hostname: host.split(':')[0], href: `${origin}/auth/msp/signin`, assign },
        configurable: true,
      });
      return assign;
    }

    it('F001: makes one top-level navigation to the canonical entry point instead of resolving and signing in on this host', async () => {
      const assign = stubLocation('https://msp.acme.test', 'msp.acme.test');
      const fetchMock = buildFetchMock({ discoverProviders: ['google', 'azure-ad'] });
      vi.stubGlobal('fetch', fetchMock as any);

      render(
        <SsoProviderButtons
          callbackUrl="https://msp.acme.test/msp/tickets?view=mine"
          email="Tech@Acme.test"
          tenantHint="abcdef012345"
          publicWorkstation
          canonicalSsoOrigin={CANONICAL}
        />
      );

      await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      const target = new URL(assign.mock.calls[0][0] as string);
      expect(target.origin).toBe(CANONICAL);
      expect(target.pathname).toBe('/api/auth/msp/sso/start');
      expect(Object.fromEntries(target.searchParams)).toEqual({
        provider: 'google',
        email: 'tech@acme.test',
        domain: 'msp.acme.test',
        return: '/msp/tickets?view=mine',
        tenant: 'abcdef012345',
        publicWorkstation: 'true',
      });

      // Neither the resolve call nor next-auth's signIn runs on the custom host.
      expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/msp/sso/resolve', expect.anything());
      expect(signInMock).not.toHaveBeenCalled();
      expect(window.localStorage.getItem('msp_sso_last_provider')).toBe('google');
    });

    it('F001: falls back to the MSP dashboard when the callback is not on this host', async () => {
      const assign = stubLocation('https://msp.acme.test', 'msp.acme.test');
      vi.stubGlobal('fetch', buildFetchMock({ discoverProviders: ['azure-ad'] }) as any);

      render(<SsoProviderButtons callbackUrl="https://evil.test/msp" email="tech@acme.test" canonicalSsoOrigin={CANONICAL} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(new URL(assign.mock.calls[0][0] as string).searchParams.get('return')).toBe('/msp/dashboard');
    });

    it('F004: on the canonical host itself the flow is unchanged (resolve, then signIn in place)', async () => {
      const assign = stubLocation(CANONICAL, 'app.alga.test');
      const fetchMock = buildFetchMock({ discoverProviders: ['azure-ad'] });
      vi.stubGlobal('fetch', fetchMock as any);

      render(<SsoProviderButtons callbackUrl="/msp/dashboard" email="tech@acme.test" canonicalSsoOrigin={CANONICAL} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

      await waitFor(() => expect(signInMock).toHaveBeenCalledWith(
        'azure-ad',
        { callbackUrl: '/msp/dashboard' },
        expect.objectContaining({ state: expect.any(String) })
      ));
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/msp/sso/resolve', expect.anything());
      expect(assign).not.toHaveBeenCalled();
    });
  });
});
