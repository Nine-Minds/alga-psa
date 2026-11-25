/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_SETUP_ENTRY_PATH } from '@alga-psa/types';

// Same classic-JSX transform caveat as the ConnectSsoClient link-error suite.
(globalThis as unknown as { React?: typeof React }).React = React;

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/profile');
});

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@ee/lib/actions/auth/connectSso', () => ({
  authorizeSsoLinkingAction: vi.fn(),
  prepareSsoLinkResolutionAction: vi.fn(),
}));

const { default: ConnectSsoClient } = await import('../ConnectSsoClient');

// Hosted shape: Google and Microsoft ride the deployment credentials, Keycloak
// is the tenant's own realm and starts unconfigured.
const baseProps = {
  email: 'admin@example.com',
  twoFactorEnabled: false,
  linkedAccounts: [],
  providerOptions: [
    { id: 'google', name: 'Google Workspace', description: 'Google', configured: false },
    { id: 'azure-ad', name: 'Microsoft 365 (Azure AD)', description: 'Microsoft', configured: true },
    { id: 'keycloak', name: 'Keycloak', description: 'Keycloak', configured: false },
  ],
};

const assignMock = vi.fn();

beforeEach(() => {
  assignMock.mockClear();
  vi.stubGlobal('location', { ...window.location, assign: assignMock });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConnectSsoClient unconfigured provider hint', () => {
  it('sends an admin to the Keycloak realm settings from the Keycloak card', () => {
    render(<ConnectSsoClient {...baseProps} canConfigureProviders />);

    const link = document.getElementById('provider-keycloak-setup') as HTMLButtonElement;
    expect(link.textContent).toBe('Set up Keycloak');

    fireEvent.click(link);
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith('/msp/security-settings?tab=single-sign-on');
  });

  it('sends an admin to the provider application page from the Google card', () => {
    render(<ConnectSsoClient {...baseProps} canConfigureProviders />);

    const link = document.getElementById('provider-google-setup') as HTMLButtonElement;
    expect(link.textContent).toBe('Set up Google Workspace');

    fireEvent.click(link);
    expect(assignMock).toHaveBeenCalledWith(PROVIDER_SETUP_ENTRY_PATH);
  });

  it('tells a non-admin to ask an administrator and offers no setup link', () => {
    render(<ConnectSsoClient {...baseProps} />);

    expect(document.getElementById('provider-keycloak-setup')).toBeNull();
    const hint = document.getElementById('provider-keycloak-not-configured') as HTMLElement;
    expect(hint.textContent).toContain('Not configured');
    expect(hint.textContent).toContain('Ask your administrator to set it up.');
  });

  it('names no provider in the banner when nothing is configured and leaves setup to the cards', () => {
    const noneConfigured = baseProps.providerOptions.map((option) => ({ ...option, configured: false }));
    render(<ConnectSsoClient {...baseProps} providerOptions={noneConfigured} canConfigureProviders />);

    const banner = screen.getByText(/No SSO providers are configured yet/);
    expect(banner.textContent).not.toMatch(/Google|Microsoft/);
    expect(document.getElementById('connect-sso-open-provider-setup')).toBeNull();
    for (const id of ['google', 'azure-ad', 'keycloak']) {
      expect(document.getElementById(`provider-${id}-setup`)).not.toBeNull();
    }
  });

  it('shows no hint on a configured provider', () => {
    render(<ConnectSsoClient {...baseProps} canConfigureProviders />);

    expect(document.getElementById('provider-azure-ad-not-configured')).toBeNull();
    expect(document.getElementById('provider-azure-ad-setup')).toBeNull();
  });
});
