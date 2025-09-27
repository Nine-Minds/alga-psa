import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const redirectMock = vi.fn();
const authMock = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('server/src/app/api/auth/[...nextauth]/auth', () => ({
  auth: authMock,
}));

vi.mock('server/src/components/auth/MspSignIn', () => ({
  __esModule: true,
  default: () => null,
}));

const { default: MspSignInPage } = await import('server/src/app/auth/msp/signin/page');

describe('MspSignInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReset();
  });

  it('redirects authenticated users to the MSP dashboard when no callback is provided', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', user_type: 'client' } });

    await MspSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).toHaveBeenCalledWith('/msp/dashboard');
  });

  it('redirects authenticated users to the provided callback when present', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-2', user_type: 'client' } });

    await MspSignInPage({ searchParams: Promise.resolve({ callbackUrl: '/msp/tickets' }) });

    expect(redirectMock).toHaveBeenCalledWith('/msp/tickets');
  });

  it('renders the sign-in component for unauthenticated users', async () => {
    authMock.mockResolvedValue(null);

    const result = await MspSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
