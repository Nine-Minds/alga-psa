/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same classic-JSX transform caveat as the ConnectSsoClient link-error suite.
(globalThis as unknown as { React?: typeof React }).React = React;

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/profile');
});

const signInMock = vi.fn(async () => undefined);
vi.mock('next-auth/react', () => ({ signIn: (...args: unknown[]) => signInMock(...(args as [])) }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const authorizeSsoLinkingActionMock = vi.fn(async () => ({
  success: true,
  nonce: 'nonce-1',
  nonceIssuedAt: 1700000000000,
  nonceSignature: 'signature-1',
}));
const prepareSsoLinkResolutionActionMock = vi.fn(async () => ({ success: true }));

vi.mock('@ee/lib/actions/auth/connectSso', () => ({
  authorizeSsoLinkingAction: (...args: unknown[]) => authorizeSsoLinkingActionMock(...(args as [])),
  prepareSsoLinkResolutionAction: (...args: unknown[]) =>
    prepareSsoLinkResolutionActionMock(...(args as [])),
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
beforeEach(() => vi.clearAllMocks());

/** Re-auth first: the provider controls stay disabled until the nonce exists. */
async function renderAuthorized(): Promise<{ button: HTMLButtonElement; card: HTMLElement }> {
  render(<ConnectSsoClient {...baseProps} />);

  const password = document.getElementById('password') as HTMLInputElement;
  fireEvent.change(password, { target: { value: 'pw' } });
  fireEvent.submit(password.closest('form')!);

  await waitFor(() => expect(authorizeSsoLinkingActionMock).toHaveBeenCalledTimes(1));

  const button = document.getElementById('provider-azure-ad') as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));

  // The whole provider tile is a button as well; only it mentions the description.
  const card = screen.getByRole('button', { name: /Microsoft Entra ID/ });
  return { button, card };
}

describe('ConnectSsoClient OAuth start', () => {
  // Every signIn() mints its own Auth.js state and PKCE cookies before
  // navigating, so a second flow started from one click overwrites the first
  // one's and the mismatch error it was meant to report is lost.
  it('starts one OAuth flow when the button inside the provider card is clicked', async () => {
    const { button } = await renderAuthorized();

    fireEvent.click(button);

    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));
    expect(prepareSsoLinkResolutionActionMock).toHaveBeenCalledTimes(1);
    expect(signInMock.mock.calls[0][0]).toBe('azure-ad');
  });

  it('ignores further clicks while the first flow is starting', async () => {
    const { button, card } = await renderAuthorized();

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(card);

    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));
    expect(prepareSsoLinkResolutionActionMock).toHaveBeenCalledTimes(1);
  });
});
