import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const redirectMock = vi.fn();
const getSessionMock = vi.fn();
const isRevokedMock = vi.fn();

const MspSignInMock = () => null;
const PortalSwitchPromptMock = () => null;

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: getSessionMock,
}));

vi.mock('server/src/lib/models/UserSession', () => ({
  UserSession: {
    isRevoked: (...args: unknown[]) => isRevokedMock(...args),
  },
}));

vi.mock('@alga-psa/auth', () => ({
  MspSignIn: MspSignInMock,
  PortalSwitchPrompt: PortalSwitchPromptMock,
}));

const { default: MspSignInPage } = await import('server/src/app/auth/msp/signin/page');

describe('MspSignInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockReset();
    isRevokedMock.mockReset();
  });

  it('redirects authenticated internal users to the MSP dashboard when no callback is provided', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', user_type: 'internal' } });

    await MspSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).toHaveBeenCalledWith('/msp/dashboard');
  });

  it('redirects authenticated internal users to the provided callback when present', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-2', user_type: 'internal' } });

    await MspSignInPage({ searchParams: Promise.resolve({ callbackUrl: '/msp/tickets' }) });

    expect(redirectMock).toHaveBeenCalledWith('/msp/tickets');
  });

  it('renders a portal switch prompt for authenticated client users', async () => {
    isRevokedMock.mockResolvedValue(false);
    getSessionMock.mockResolvedValue({
      user: { id: 'user-3', user_type: 'client', tenant: 'tenant-1', email: 'client@example.com' },
      session_id: 'session-1',
    });

    const result = await MspSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(PortalSwitchPromptMock);
  });

  it('renders the sign-in component for unauthenticated users', async () => {
    getSessionMock.mockResolvedValue(null);

    const result = await MspSignInPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(MspSignInMock);
  });
});
