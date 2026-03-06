/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

const signInMock = vi.fn(async () => null);

vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

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

describe('MspLoginForm remembered email behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('T003: initializes the email field from initialEmail', () => {
    render(
      <MspLoginForm
        callbackUrl="/msp/dashboard"
        initialEmail="remembered@example.com"
        onError={vi.fn()}
        onTwoFactorRequired={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Email')).toHaveValue('remembered@example.com');
  });

  it('T004: renders the public workstation checkbox', () => {
    render(
      <MspLoginForm
        callbackUrl="/msp/dashboard"
        onError={vi.fn()}
        onTwoFactorRequired={vi.fn()}
      />
    );

    expect(
      screen.getByLabelText('Public workstation - do not remember my email')
    ).toBeInTheDocument();
  });

  it('T005: leaves the public workstation checkbox unchecked by default', () => {
    render(
      <MspLoginForm
        callbackUrl="/msp/dashboard"
        onError={vi.fn()}
        onTwoFactorRequired={vi.fn()}
      />
    );

    expect(
      screen.getByLabelText('Public workstation - do not remember my email')
    ).not.toBeChecked();
  });

  it('T008: does not call remember-email persistence when credentials sign-in fails', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    signInMock.mockResolvedValueOnce({ error: 'CredentialsSignin' });

    render(
      <MspLoginForm
        callbackUrl="/msp/dashboard"
        onError={vi.fn()}
        onTwoFactorRequired={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'bad-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith(
        'credentials',
        expect.objectContaining({
          email: 'user@example.com',
          password: 'bad-password',
          redirect: false,
        })
      )
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
