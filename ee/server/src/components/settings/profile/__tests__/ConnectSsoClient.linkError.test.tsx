/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ConnectSsoClient relies on Next's automatic JSX runtime; this suite's esbuild
// transform uses the classic one, so React has to be reachable globally before
// the component module evaluates its JSX-valued constants.
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

const { default: ConnectSsoClient } = await import('../ConnectSsoClient');

const baseProps = {
  email: 'nd@computerbutler.eu',
  twoFactorEnabled: false,
  linkedAccounts: [],
  providerOptions: [
    { id: 'azure-ad', name: 'Microsoft', description: 'Microsoft Entra ID', configured: true },
  ],
};

afterEach(() => cleanup());

describe('ConnectSsoClient link failure banner', () => {
  it('names both the provider email and the AlgaPSA login when no user matched', () => {
    render(
      <ConnectSsoClient
        {...baseProps}
        linkStatus="error"
        linkErrorCode="no_matching_user"
        linkErrorProviderEmail="nd@computerbutlereurope.onmicrosoft.com"
      />
    );

    const banner = screen.getByText(/nd@computerbutlereurope\.onmicrosoft\.com/);
    expect(banner.textContent).toContain('nd@computerbutler.eu');
    expect(banner.textContent).not.toContain('connectSso.linkError');
  });

  it('falls back to the generic message for an unrecognized code', () => {
    render(
      <ConnectSsoClient
        {...baseProps}
        linkStatus="error"
        linkErrorCode="something_new"
        linkErrorProviderEmail="someone@example.com"
      />
    );

    const banner = screen.getByText(/We could not link that account to nd@computerbutler\.eu/);
    expect(banner).toBeTruthy();
  });

  it('renders no failure banner without a link error', () => {
    render(<ConnectSsoClient {...baseProps} />);

    expect(screen.queryByText(/SSO link failed/)).toBeNull();
  });
});
