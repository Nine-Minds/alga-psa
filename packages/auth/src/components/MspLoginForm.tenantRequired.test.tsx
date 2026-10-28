/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

const signInMock = vi.fn();
const requestLinksMock = vi.fn(async () => ({ success: true, message: 'x' }));
const ssoPropsMock = vi.fn();
const refreshChallengeMock = vi.fn();
const requireCaptchaMock = vi.fn(async () => undefined);

vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

// The captcha challenge is already on screen, so a wrongly handled error would
// visibly escalate it by calling refreshChallenge.
vi.mock('./useLoginCaptcha', () => ({
  useLoginCaptcha: () => ({
    required: true,
    token: null,
    refreshChallenge: refreshChallengeMock,
    requireCaptcha: requireCaptchaMock,
  }),
}));

vi.mock('./CaptchaChallenge', () => ({ __esModule: true, default: () => null }));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@alga-psa/ui/components', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Input: ({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Alert: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Checkbox: ({
    label,
    id,
    checked,
    onChange,
  }: {
    label?: React.ReactNode;
    id?: string;
    checked?: boolean;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
  }) => (
    <div>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} />
      {label ? <label htmlFor={id}>{label}</label> : null}
    </div>
  ),
}));

vi.mock('@alga-psa/auth/sso/entry', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    ssoPropsMock(props);
    return null;
  },
}));

const { default: MspLoginForm } = await import('./MspLoginForm');

async function submitWith(result: unknown, props: Record<string, unknown> = {}) {
  signInMock.mockResolvedValue(result);
  const onError = vi.fn();
  const onTwoFactorRequired = vi.fn();
  render(
    <MspLoginForm
      requestSignInLinks={requestLinksMock}
      callbackUrl="/msp/dashboard"
      onError={onError}
      onTwoFactorRequired={onTwoFactorRequired}
      {...props}
    />
  );
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dup@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
  await waitFor(() => expect(signInMock).toHaveBeenCalled());
  return { onError, onTwoFactorRequired };
}

const TENANT_REQUIRED = { error: 'CredentialsSignin', code: 'TENANT_REQUIRED' };

describe('MspLoginForm TENANT_REQUIRED handling', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('offers to email one sign-in link per organization instead of an error alert', async () => {
    const { onError } = await submitWith(TENANT_REQUIRED);

    const button = await screen.findByRole('button', { name: 'Email me my sign-in links' });
    expect(button.id).toBe('msp-send-org-links-button');
    expect(screen.getByText(/more than one organization/)).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not refresh the captcha, because the password was correct', async () => {
    await submitWith(TENANT_REQUIRED);
    await screen.findByRole('button', { name: 'Email me my sign-in links' });
    expect(refreshChallengeMock).not.toHaveBeenCalled();
    expect(requireCaptchaMock).not.toHaveBeenCalled();
  });

  it('sends the typed email and callbackUrl, then shows the generic confirmation and disables the button', async () => {
    await submitWith(TENANT_REQUIRED);
    fireEvent.click(await screen.findByRole('button', { name: 'Email me my sign-in links' }));

    await waitFor(() => expect(requestLinksMock).toHaveBeenCalledWith('dup@example.com', '/msp/dashboard'));
    expect(await screen.findByText('If an account exists with that email, sign-in links have been sent.')).toBeTruthy();
    expect((document.getElementById('msp-send-org-links-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the same confirmation when the request throws', async () => {
    requestLinksMock.mockRejectedValueOnce(new Error('boom'));
    await submitWith(TENANT_REQUIRED);
    fireEvent.click(await screen.findByRole('button', { name: 'Email me my sign-in links' }));
    expect(await screen.findByText('If an account exists with that email, sign-in links have been sent.')).toBeTruthy();
  });

  it('clears the offer when the email field changes', async () => {
    await submitWith(TENANT_REQUIRED);
    await screen.findByRole('button', { name: 'Email me my sign-in links' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'other@example.com' } });
    expect(document.getElementById('msp-send-org-links-button')).toBeNull();
  });

  it('opens with the offer when handed off from SSO', () => {
    render(
      <MspLoginForm
        requestSignInLinks={requestLinksMock}
        callbackUrl="/msp/dashboard"
        initialEmail="sso@example.com"
        initialTenantRequired
        onError={vi.fn()}
        onTwoFactorRequired={vi.fn()}
      />
    );
    expect(document.getElementById('msp-send-org-links-button')).not.toBeNull();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('sso@example.com');
  });

  it('leaves the generic failure branch unchanged and refreshes the captcha', async () => {
    const { onError } = await submitWith({ error: 'CredentialsSignin', code: 'credentials' });
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect((onError.mock.calls[0][0] as { title: string }).title).toBe('Sign-in Failed');
    expect(refreshChallengeMock).toHaveBeenCalledTimes(1);
    expect(document.getElementById('msp-send-org-links-button')).toBeNull();
  });

  it('leaves the RATE_LIMITED branch unchanged', async () => {
    const { onError } = await submitWith({ error: 'CredentialsSignin', code: 'RATE_LIMITED' });
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect((onError.mock.calls[0][0] as { title: string }).title).toBe('Too Many Attempts');
    expect(refreshChallengeMock).not.toHaveBeenCalled();
  });

  it('leaves the 2FA_REQUIRED branch unchanged', async () => {
    const { onError, onTwoFactorRequired } = await submitWith({ error: '2FA_REQUIRED' });
    await waitFor(() => expect(onTwoFactorRequired).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it('emails the SSO providerEmail, not a remembered address, when the hand-off supplies it', async () => {
    // MspSignIn resolves providerEmail over the remembered email (b@x over a@x)
    // before it reaches the form; the field and the links action then agree.
    render(
      <MspLoginForm
        requestSignInLinks={requestLinksMock}
        callbackUrl="/msp/dashboard"
        initialEmail="b@x"
        initialTenantRequired
        onError={vi.fn()}
        onTwoFactorRequired={vi.fn()}
      />
    );
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('b@x');
    fireEvent.click(await screen.findByRole('button', { name: 'Email me my sign-in links' }));
    await waitFor(() => expect(requestLinksMock).toHaveBeenCalledWith('b@x', '/msp/dashboard'));
  });
});
