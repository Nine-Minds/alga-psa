/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same classic-JSX transform caveat as the ConnectSsoClient suite.
(globalThis as unknown as { React?: typeof React }).React = React;

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/profile');
});

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));

vi.mock('@ee/lib/actions/auth/connectSso', () => ({
  authorizeSsoLinkingAction: vi.fn(),
  prepareSsoLinkResolutionAction: vi.fn(),
}));

const searchParams = { value: new URLSearchParams() };
const routerReplaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.value,
  useRouter: () => ({ replace: routerReplaceMock, refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@ee/lib/actions/auth/getSsoProviderOptions', () => ({
  getSsoProviderOptionsAction: vi.fn(async () => ({
    options: [{ id: 'azure-ad', name: 'Microsoft', description: 'Microsoft Entra ID', configured: true }],
  })),
}));

vi.mock('@ee/lib/actions/auth/ssoPreferences', () => ({
  getLinkedSsoAccountsAction: vi.fn(async () => ({
    success: true,
    accounts: [],
    email: 'nd@computerbutler.eu',
    twoFactorEnabled: false,
  })),
}));

const { default: ConnectSsoWrapper } = await import('../ConnectSsoWrapper');

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/msp/profile?tab=single-sign-on');
});

describe('ConnectSsoWrapper link outcome', () => {
  it('shows the failure banner and strips the params without leaving the SSO tab', async () => {
    searchParams.value = new URLSearchParams({
      tab: 'single-sign-on',
      linkError: 'no_matching_user',
      providerEmail: 'nd@computerbutlereurope.onmicrosoft.com',
    });
    window.history.replaceState({}, '', `/msp/profile?${searchParams.value.toString()}`);

    render(<ConnectSsoWrapper />);

    const banner = await screen.findByText(/nd@computerbutlereurope\.onmicrosoft\.com/);
    expect(banner.textContent).toContain('nd@computerbutler.eu');

    // A router navigation would re-resolve `tab` and unmount the banner with the
    // tab; the History API keeps the user where the outcome is readable.
    await waitFor(() => {
      expect(window.location.search).toBe('?tab=single-sign-on');
    });
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(screen.getByText(/nd@computerbutlereurope\.onmicrosoft\.com/)).toBeTruthy();
  });

  it('leaves the URL alone when there is no link outcome to report', async () => {
    searchParams.value = new URLSearchParams({ tab: 'single-sign-on' });

    render(<ConnectSsoWrapper />);

    await screen.findByDisplayValue('nd@computerbutler.eu');
    expect(window.location.search).toBe('?tab=single-sign-on');
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});
