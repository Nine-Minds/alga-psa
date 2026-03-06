/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

function buildFetchMock(options: {
  discoverProviders: Array<'google' | 'azure-ad'>;
  resolveOk?: boolean;
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

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

describe('MSP SSO provider buttons', () => {
  beforeEach(() => {
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
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(<SsoProviderButtons callbackUrl="/msp" email="not-an-email" />);

    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('T032: remains disabled while discovery request is in flight', async () => {
    let resolveDiscovery: ((value: unknown) => void) | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
          body: JSON.stringify({ email: 'remembered@example.com' }),
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
});
