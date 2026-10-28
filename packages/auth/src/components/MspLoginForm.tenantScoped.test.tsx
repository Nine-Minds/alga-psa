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

async function submit(props: Record<string, unknown>) {
  signInMock.mockResolvedValue({ url: '/msp/dashboard' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });
  render(
    <MspLoginForm requestSignInLinks={requestLinksMock} callbackUrl="/msp/tickets" onError={vi.fn()} onTwoFactorRequired={vi.fn()} {...props} />
  );
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dup@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
  await waitFor(() => expect(signInMock).toHaveBeenCalled());
}

describe('MspLoginForm tenant scoping', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('passes the scoped tenant slug to signIn(credentials)', async () => {
    await submit({ tenantSlug: 'abc123def456' });
    const [provider, options] = signInMock.mock.calls[0];
    expect(provider).toBe('credentials');
    expect(options).toMatchObject({
      email: 'dup@example.com',
      userType: 'internal',
      tenant: 'abc123def456',
      callbackUrl: '/msp/tickets',
    });
  });

  it('sends no tenant when the page is unscoped', async () => {
    await submit({});
    expect(signInMock.mock.calls[0][1]).not.toHaveProperty('tenant');
  });

  it('hands the tenant to the SSO buttons as tenantHint', async () => {
    await submit({ tenantSlug: 'abc123def456' });
    expect(ssoPropsMock).toHaveBeenCalledWith(expect.objectContaining({ tenantHint: 'abc123def456' }));
  });
});
