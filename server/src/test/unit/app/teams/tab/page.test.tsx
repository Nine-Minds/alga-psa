import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const redirectMock = vi.fn();
const resolveTeamsTabAuthStateMock = vi.fn();
const CardMock = vi.fn((props: { children?: React.ReactNode }) => null);

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: CardMock,
}));

vi.mock('server/src/lib/teams/resolveTeamsTabAuthState', () => ({
  resolveTeamsTabAuthState: (...args: unknown[]) => resolveTeamsTabAuthStateMock(...args),
}));

const { default: TeamsTabPage } = await import('server/src/app/teams/tab/page');

describe('TeamsTabPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTeamsTabAuthStateMock.mockReset();
  });

  it('redirects unauthenticated users into the MSP sign-in flow with a Teams tab callback', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue({
      status: 'unauthenticated',
      message: 'Sign in with your MSP account to open Alga PSA in Teams.',
    });

    await TeamsTabPage({
      searchParams: Promise.resolve({ page: 'ticket', ticketId: '12345' }),
    });

    expect(resolveTeamsTabAuthStateMock).toHaveBeenCalledWith({ expectedTenantId: undefined });
    expect(redirectMock).toHaveBeenCalledWith(
      '/auth/msp/signin?callbackUrl=%2Fteams%2Ftab%3Fpage%3Dticket%26ticketId%3D12345'
    );
  });

  it('renders the Teams landing view when the tab auth state is ready', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue({
      status: 'ready',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userName: 'Taylor Tech',
      userEmail: 'taylor@example.com',
      profileId: 'profile-1',
      microsoftTenantId: 'entra-tenant-1',
    });

    const result = await TeamsTabPage({
      searchParams: Promise.resolve({ tenantId: 'tenant-1' }),
    });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(resolveTeamsTabAuthStateMock).toHaveBeenCalledWith({ expectedTenantId: 'tenant-1' });
    expect((result as any)?.props?.['data-teams-tab-state']).toBe('ready');
  });

  it('renders a Teams-safe remediation card when the tenant is not ready', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      message: 'Teams is not configured for this tenant',
    });

    const result = await TeamsTabPage({
      searchParams: Promise.resolve({ tenantId: 'tenant-1' }),
    });

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(CardMock);
  });
});
