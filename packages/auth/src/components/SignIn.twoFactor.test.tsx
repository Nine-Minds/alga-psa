/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(), refresh: vi.fn(), requireCaptcha: vi.fn(),
  update: vi.fn(), captchaToken: 'captcha-token', params: new URLSearchParams('callbackUrl=/signed-in'),
}));
vi.mock('next-auth/react', () => ({ signIn: mocks.signIn }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('@alga-psa/auth/sso/entry', () => ({ default: () => null }));
vi.mock('./CaptchaChallenge', () => ({ default: () => null }));
vi.mock('./useLoginCaptcha', () => ({ useLoginCaptcha: () => ({
  token: mocks.captchaToken, required: true, refreshChallenge: mocks.refresh, requireCaptcha: mocks.requireCaptcha,
}) }));
vi.mock('@alga-psa/ui/ui-reflection', () => ({
  useRegisterUIComponent: () => mocks.update,
  withDataAutomationId: () => ({}),
}));
vi.mock('@alga-psa/ui/components/Card', () => {
  const Box = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return { Card: Box, CardHeader: Box, CardTitle: Box, CardDescription: Box, CardContent: Box };
});
vi.mock('@alga-psa/ui/components', () => {
  const Box = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Card: Box, CardHeader: Box, CardTitle: Box, CardDescription: Box, CardContent: Box,
    Alert: Box, AlertTitle: Box, AlertDescription: Box, DialogContent: Box,
    Dialog: ({ children, isOpen, onClose, id }: any) => isOpen ? <div role="dialog" id={id}>
      <button onClick={onClose}>Cancel challenge</button>{children}</div> : null,
    Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => <input ref={ref} {...props} />),
    Label: (props: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props} />,
    Button: ({ variant: _variant, ...props }: any) => <button {...props} />,
    Checkbox: ({ id, label, checked, onChange }: any) => <label><input id={id} type="checkbox" checked={checked} onChange={onChange} />{label}</label>,
  };
});
vi.mock('./Alert', () => ({ default: ({ isOpen, message, onClose }: any) => isOpen ?
  <div role="alert">{message}<button onClick={onClose}>Dismiss error</button></div> : null }));

import MspSignIn from './MspSignIn';
import ClientPortalSignIn from './ClientPortalSignIn';

const CHALLENGE = { error: 'CredentialsSignin', code: '2FA_REQUIRED' };
const REJECTED = { error: 'CredentialsSignin', code: 'credentials' };

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.signIn.mockReset();
  mocks.captchaToken = 'captcha-token';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  vi.stubGlobal('location', { href: '' });
});

describe.each(['internal', 'client'] as const)('%s sign-in through the real form and TOTP dialog', (userType) => {
  function openForm() {
    if (userType === 'internal') render(<MspSignIn requestSignInLinks={vi.fn()} scopedTenant={{ slug: 'abc123def456' }} />);
    else render(<ClientPortalSignIn tenantSlug="abc123def456" portalDomain="portal.example.test" />);
    const email = document.querySelector('input[type=email]')!;
    const password = document.querySelector('input[type=password]')!;
    fireEvent.change(email, { target: { value: 'person@example.test' } });
    fireEvent.change(password, { target: { value: 'correct-password' } });
    return () => fireEvent.submit(email.closest('form')!);
  }
  function enterCode(code = '123456') {
    [...code].forEach((digit, index) => fireEvent.change(document.getElementById(`2fa-digit-${index}`)!, { target: { value: digit } }));
  }

  it('opens a challenge, resubmits the code with all context, and navigates on success', async () => {
    mocks.signIn.mockResolvedValueOnce(CHALLENGE).mockResolvedValueOnce({ url: '/signed-in' });
    openForm()();
    await screen.findByRole('dialog');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
    const firstPayload = mocks.signIn.mock.calls[0][1];
    expect(firstPayload).toMatchObject({ email: 'person@example.test', password: 'correct-password',
      userType, tenant: 'abc123def456', callbackUrl: '/signed-in', captchaToken: 'captcha-token', redirect: false });
    if (userType === 'client') expect(firstPayload.portalDomain).toBe('portal.example.test');
    expect(firstPayload).not.toHaveProperty('twoFactorCode');
    enterCode();
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(2));
    expect(mocks.signIn.mock.calls[1][1]).toEqual({ ...firstPayload, twoFactorCode: '123456' });
    await waitFor(() => expect(window.location.href).toBe('/signed-in'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels without submitting a partial code and supports a fresh challenge', async () => {
    mocks.signIn.mockResolvedValue(CHALLENGE);
    const submit = openForm(); submit();
    await screen.findByRole('dialog');
    enterCode('12');
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Cancel challenge'));
    expect(screen.queryByRole('dialog')).toBeNull();
    submit();
    await screen.findByRole('dialog');
    expect((document.getElementById('2fa-digit-0') as HTMLInputElement).value).toBe('');
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
    expect(mocks.signIn.mock.calls[1][1]).not.toHaveProperty('twoFactorCode');
  });

  it('shows rejection for an invalid code and permits a successful retry', async () => {
    mocks.signIn.mockResolvedValueOnce(CHALLENGE).mockResolvedValueOnce(REJECTED)
      .mockResolvedValueOnce(CHALLENGE).mockResolvedValueOnce({ url: '/signed-in' });
    const submit = openForm(); submit();
    await screen.findByRole('dialog'); enterCode();
    await screen.findByRole('alert');
    expect(window.location.href).toBe('');
    expect(mocks.refresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Dismiss error'));
    submit();
    await screen.findByRole('dialog'); enterCode('654321');
    await waitFor(() => expect(window.location.href).toBe('/signed-in'));
    expect(mocks.signIn.mock.calls[3][1].twoFactorCode).toBe('654321');
  });

  it('shows an error without a challenge for a wrong password', async () => {
    mocks.signIn.mockResolvedValueOnce(REJECTED);
    openForm()();
    await screen.findByRole('alert');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.href).toBe('');
    expect(mocks.signIn).toHaveBeenCalledOnce();
  });

  it('keeps the code through a fresh CAPTCHA without looping back to the TOTP challenge', async () => {
    const usedTokens = new Set<string>();
    mocks.signIn.mockImplementation(async (_provider, payload) => {
      if (!payload.captchaToken || usedTokens.has(payload.captchaToken)) {
        return { error: 'CredentialsSignin', code: 'CAPTCHA_REQUIRED' };
      }
      usedTokens.add(payload.captchaToken);
      return payload.twoFactorCode ? { url: '/signed-in' } : CHALLENGE;
    });
    const submit = openForm(); submit();
    await screen.findByRole('dialog'); enterCode();
    await waitFor(() => expect(mocks.requireCaptcha).toHaveBeenCalledOnce());
    expect(window.location.href).toBe('');
    mocks.captchaToken = 'fresh-captcha-token';
    // A CAPTCHA widget normally sets state; an edit triggers this test stub's render.
    fireEvent.change(document.querySelector('input[type=email]')!, { target: { value: 'Person@example.test' } });
    fireEvent.change(document.querySelector('input[type=email]')!, { target: { value: 'person@example.test' } });
    submit();
    await waitFor(() => expect(window.location.href).toBe('/signed-in'));
    expect(mocks.signIn.mock.calls[2][1]).toMatchObject({ twoFactorCode: '123456', captchaToken: 'fresh-captcha-token' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not reuse a pending TOTP code when the primary credentials change', async () => {
    mocks.signIn.mockResolvedValueOnce(CHALLENGE)
      .mockResolvedValueOnce({ error: 'CredentialsSignin', code: 'CAPTCHA_REQUIRED' })
      .mockResolvedValueOnce(REJECTED);
    const submit = openForm(); submit();
    await screen.findByRole('dialog'); enterCode();
    await waitFor(() => expect(mocks.requireCaptcha).toHaveBeenCalledOnce());
    fireEvent.change(document.querySelector('input[type=password]')!, { target: { value: 'different-password' } });
    submit();
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(3));
    expect(mocks.signIn.mock.calls[2][1]).not.toHaveProperty('twoFactorCode');
  });

  it.each(['CAPTCHA_REQUIRED', 'RATE_LIMITED'])('preserves %s on code resubmission', async (code) => {
    mocks.signIn.mockResolvedValueOnce(CHALLENGE).mockResolvedValueOnce({ error: 'CredentialsSignin', code });
    openForm()();
    await screen.findByRole('dialog'); enterCode();
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.href).toBe('');
    if (code === 'CAPTCHA_REQUIRED') await waitFor(() => expect(mocks.requireCaptcha).toHaveBeenCalledOnce());
    else await screen.findByRole('alert');
  });
});
