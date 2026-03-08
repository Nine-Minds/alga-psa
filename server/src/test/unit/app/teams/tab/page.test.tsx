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

  it('T171: redirects expired or invalid Teams tab sessions into a Teams-safe MSP reauthentication path', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue({
      status: 'unauthenticated',
      message: 'Sign in with your MSP account to open Alga PSA in Teams.',
    });

    await TeamsTabPage({
      searchParams: Promise.resolve({
        context: JSON.stringify({ page: 'ticket', ticketId: '12345' }),
      }),
    });

    expect(resolveTeamsTabAuthStateMock).toHaveBeenCalledWith({
      expectedTenantId: undefined,
      expectedMicrosoftTenantId: undefined,
    });
    expect(redirectMock).toHaveBeenCalledWith(
      '/auth/msp/signin?callbackUrl=%2Fteams%2Ftab%3Fcontext%3D%257B%2522page%2522%253A%2522ticket%2522%252C%2522ticketId%2522%253A%252212345%2522%257D&teamsReauth=1'
    );
  });

  it('T169: bootstraps a deep-linked Teams tab destination without requiring a second PSA sign-in prompt inside Teams', async () => {
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
      searchParams: Promise.resolve({
        tenant: 'acme-helpdesk',
        tid: 'entra-tenant-1',
        context: JSON.stringify({ page: 'ticket', ticketId: '12345' }),
      }),
    });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(resolveTeamsTabAuthStateMock).toHaveBeenCalledWith({
      expectedTenantId: 'acme-helpdesk',
      expectedMicrosoftTenantId: 'entra-tenant-1',
    });
    expect((result as any)?.props?.['data-teams-tab-state']).toBe('ready');
    expect((result as any)?.props?.['data-teams-tab-destination']).toBe('ticket');
  });

  it('T170: returns Teams-safe remediation for rejected or unavailable deep-link entry points', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue({
      status: 'forbidden',
      reason: 'wrong_tenant',
      tenantId: 'tenant-1',
      message: 'This Teams tab request does not match your PSA tenant.',
    });

    const result = await TeamsTabPage({
      searchParams: Promise.resolve({
        tenantId: 'tenant-1',
        context: JSON.stringify({ page: 'ticket', ticketId: '12345' }),
      }),
    });

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(CardMock);
  });
});
