/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

const signInMock = vi.fn();
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
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  default: () => null,
}));

const { default: MspLoginForm } = await import('./MspLoginForm');

async function submitWith(result: unknown) {
  signInMock.mockResolvedValue(result);
  const onError = vi.fn();
  const onTwoFactorRequired = vi.fn();
  render(
    <MspLoginForm
      callbackUrl="/msp/dashboard"
      onError={onError}
      onTwoFactorRequired={onTwoFactorRequired}
    />
  );
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dup@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
  await waitFor(() => expect(signInMock).toHaveBeenCalled());
  return { onError, onTwoFactorRequired };
}

describe('MspLoginForm TENANT_REQUIRED handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends the user to an administrator instead of reporting bad credentials', async () => {
    const { onError } = await submitWith({ error: 'CredentialsSignin', code: 'TENANT_REQUIRED' });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    const alert = onError.mock.calls[0][0] as { type: string; title: string; message: string };
    expect(alert.type).toBe('error');
    expect(alert.title).toBe('Contact Your Administrator');
    expect(alert.message).toContain('more than one organization');
    expect(alert.message).toContain('Contact your administrator');
    // MSP sign-in has no per-organization address to send them to.
    expect(alert.message).not.toContain('sign-in address');
    expect(alert.message).not.toContain('Invalid email or password');
  });

  it('does not refresh the captcha, because the password was correct', async () => {
    const { onError } = await submitWith({ error: 'CredentialsSignin', code: 'TENANT_REQUIRED' });
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(refreshChallengeMock).not.toHaveBeenCalled();
    expect(requireCaptchaMock).not.toHaveBeenCalled();
  });

  it('leaves the generic failure branch unchanged and refreshes the captcha', async () => {
    const { onError } = await submitWith({ error: 'CredentialsSignin', code: 'credentials' });
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect((onError.mock.calls[0][0] as { title: string }).title).toBe('Sign-in Failed');
    expect(refreshChallengeMock).toHaveBeenCalledTimes(1);
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
});
