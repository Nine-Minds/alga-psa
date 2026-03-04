/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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

function mockDiscover(providers: Array<'google' | 'azure-ad'>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
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

describe('SsoProviderButtons runtime DOM behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
  });

  it('renders both provider buttons with icon SVGs', async () => {
    const fetchMock = mockDiscover(['google', 'azure-ad']);
    vi.stubGlobal('fetch', fetchMock as any);

    render(
      React.createElement(SsoProviderButtons, {
        callbackUrl: '/msp/dashboard',
        email: 'admin@example.com',
      })
    );

    await waitFor(() => {
      const googleButton = document.getElementById('sso-provider-google-button');
      const microsoftButton = document.getElementById('sso-provider-azure-ad-button');
      expect(googleButton).toBeTruthy();
      expect(microsoftButton).toBeTruthy();
    });

    const googleButton = document.getElementById('sso-provider-google-button');
    const microsoftButton = document.getElementById('sso-provider-azure-ad-button');
    expect(googleButton?.querySelector('svg')).toBeTruthy();
    expect(microsoftButton?.querySelector('svg')).toBeTruthy();
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
      const microsoftButton = document.getElementById('sso-provider-azure-ad-button') as HTMLButtonElement | null;
      expect(Boolean(microsoftButton && !microsoftButton.disabled)).toBe(true);
    });

    const googleButton = document.getElementById('sso-provider-google-button') as HTMLButtonElement | null;
    expect(Boolean(googleButton?.disabled)).toBe(true);
  });
});
