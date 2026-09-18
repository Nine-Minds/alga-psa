/** @vitest-environment jsdom */

import React from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SsoProviderButtons from './SsoProviderButtons';

const reactWithAct = React as unknown as { act?: (callback: () => unknown) => unknown };
if (typeof reactWithAct.act !== 'function') {
  reactWithAct.act = (callback: () => unknown) => callback();
}

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(async () => null),
}));

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

function mockDiscover(providers: Array<'google' | 'azure-ad' | 'keycloak'>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/auth/providers') {
      return {
        ok: true,
        json: async () => ({ google: { id: 'google' }, 'azure-ad': { id: 'azure-ad' }, keycloak: { id: 'keycloak' } }),
      };
    }
    if (url === '/api/auth/msp/sso/discover') {
      return {
        ok: true,
        json: async () => ({ ok: true, providers }),
      };
    }

    if (url === '/api/auth/msp/sso/resolve') {
      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  });
}

const savedEdition = process.env.NEXT_PUBLIC_EDITION;

describe('SsoProviderButtons runtime DOM behavior', () => {
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

  it('renders all provider buttons with icon SVGs', async () => {
    const fetchMock = mockDiscover(['google', 'azure-ad', 'keycloak']);
    vi.stubGlobal('fetch', fetchMock as any);

    render(
      React.createElement(SsoProviderButtons, {
        callbackUrl: '/msp/dashboard',
        email: 'admin@example.com',
      })
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Sign in with Keycloak' })).toBeTruthy();
    });

    const googleButton = screen.getByRole('button', { name: 'Sign in with Google' });
    const microsoftButton = screen.getByRole('button', { name: 'Sign in with Microsoft' });
    const keycloakButton = screen.getByRole('button', { name: 'Sign in with Keycloak' });
    expect(googleButton?.querySelector('svg')).toBeTruthy();
    expect(microsoftButton?.querySelector('svg')).toBeTruthy();
    expect(keycloakButton?.querySelector('svg')).toBeTruthy();
  });

  it('enables only discovered provider after valid-email lookup', async () => {
    const fetchMock = mockDiscover(['azure-ad']);
    vi.stubGlobal('fetch', fetchMock as any);

    render(
      React.createElement(SsoProviderButtons, {
        callbackUrl: '/msp/dashboard',
        email: 'admin@example.com',
      })
    );

    await waitFor(() => {
      const microsoftButton = screen.getByRole('button', {
        name: 'Sign in with Microsoft',
      }) as HTMLButtonElement;
      expect(microsoftButton.disabled).toBe(false);
    });

    const googleButton = screen.getByRole('button', {
      name: 'Sign in with Google',
    }) as HTMLButtonElement;
    expect(googleButton.disabled).toBe(true);
  });
});
