/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const signInMock = vi.fn(async () => null);

vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

import SsoProviderButtons from './SsoProviderButtons';

describe('MSP SSO provider buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T024: renders Google and Microsoft buttons in CE implementation', () => {
    render(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument();
  });

  it('T025: keeps SSO buttons disabled until email is non-empty', () => {
    const { rerender } = render(<SsoProviderButtons callbackUrl="/msp" email="   " />);

    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeDisabled();

    rerender(<SsoProviderButtons callbackUrl="/msp" email="user@example.com" />);

    expect(screen.getByRole('button', { name: 'Sign in with Google' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).not.toBeDisabled();
  });

  it('T026: Microsoft click calls resolver before NextAuth signIn', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/dashboard" email="admin@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/msp/sso/resolve',
      expect.objectContaining({
        method: 'POST',
      })
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      provider: 'azure-ad',
      email: 'admin@example.com',
      callbackUrl: '/dashboard',
    });

    expect(signInMock).toHaveBeenCalledWith(
      'azure-ad',
      { callbackUrl: '/dashboard' },
      expect.objectContaining({ state: expect.any(String) })
    );

    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(signInMock.mock.invocationCallOrder[0]);
  });

  it('T027: Google click calls resolver before NextAuth signIn', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/dashboard" email="admin@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.provider).toBe('google');
    expect(signInMock).toHaveBeenCalledWith(
      'google',
      { callbackUrl: '/dashboard' },
      expect.objectContaining({ state: expect.any(String) })
    );
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(signInMock.mock.invocationCallOrder[0]);
  });

  it('T028: resolver/start failures always surface the same generic message', async () => {
    const onError = vi.fn();
    const generic = "We couldn't start SSO sign-in. Please verify provider setup and try again.";

    const fetchFailure = vi.fn(async () => ({
      ok: false,
      json: async () => ({ ok: false, message: 'specific backend reason' }),
    }));
    vi.stubGlobal('fetch', fetchFailure as any);

    const { rerender } = render(
      <SsoProviderButtons callbackUrl="/dashboard" email="admin@example.com" onError={onError} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(generic));

    const thrownFetch = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', thrownFetch as any);

    rerender(<SsoProviderButtons callbackUrl="/dashboard" email="admin@example.com" onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(generic));
  });

  it('T066: end-to-end contract for Microsoft tenant-source success reaches NextAuth signIn', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/post-auth" email="tenant-user@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith(
      'azure-ad',
      { callbackUrl: '/post-auth' },
      expect.objectContaining({ state: expect.any(String) })
    ));
  });

  it('T067: end-to-end contract for Google tenant-source success reaches NextAuth signIn', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/post-auth" email="tenant-user@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith(
      'google',
      { callbackUrl: '/post-auth' },
      expect.objectContaining({ state: expect.any(String) })
    ));
  });

  it('T068: end-to-end contract for Microsoft app-fallback success reaches NextAuth signIn', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/post-auth" email="fallback-user@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith(
      'azure-ad',
      { callbackUrl: '/post-auth' },
      expect.objectContaining({ state: expect.any(String) })
    ));
  });

  it('T069: end-to-end contract for Google app-fallback success reaches NextAuth signIn', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    render(<SsoProviderButtons callbackUrl="/post-auth" email="fallback-user@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith(
      'google',
      { callbackUrl: '/post-auth' },
      expect.objectContaining({ state: expect.any(String) })
    ));
  });

  it('T070: unknown-user and known-unconfigured-tenant failures share one generic UI error', async () => {
    const onError = vi.fn();
    const generic = "We couldn't start SSO sign-in. Please verify provider setup and try again.";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ ok: false, message: 'unknown user path' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ ok: false, message: 'known unconfigured tenant path' }),
      });
    vi.stubGlobal('fetch', fetchMock as any);

    const { rerender } = render(
      <SsoProviderButtons callbackUrl="/post-auth" email="someone@example.com" onError={onError} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(generic));

    rerender(<SsoProviderButtons callbackUrl="/post-auth" email="someone@example.com" onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(generic));
  });
});
