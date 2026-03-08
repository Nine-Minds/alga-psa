import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const redirectMock = vi.fn();
const resolveTeamsTabAuthStateMock = vi.fn();
const resolveTeamsTabAccessStateMock = vi.fn();
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

vi.mock('server/src/lib/teams/resolveTeamsTabAccessState', () => ({
  resolveTeamsTabAccessState: (...args: unknown[]) => resolveTeamsTabAccessStateMock(...args),
}));

const { default: TeamsTabPage } = await import('server/src/app/teams/tab/page');

function collectText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((entry) => collectText(entry)).join(' ');
  }

  if (React.isValidElement(node)) {
    return collectText(node.props.children);
  }

  return '';
}

function collectNormalizedText(node: React.ReactNode): string {
  return collectText(node).replace(/\s+/g, ' ').trim();
}

const readyAuthState = {
  status: 'ready' as const,
  tenantId: 'tenant-1',
  userId: 'user-1',
  userName: 'Taylor Tech',
  userEmail: 'taylor@example.com',
  profileId: 'profile-1',
  microsoftTenantId: 'entra-tenant-1',
};

describe('TeamsTabPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTeamsTabAuthStateMock.mockReset();
    resolveTeamsTabAccessStateMock.mockReset();
    resolveTeamsTabAccessStateMock.mockResolvedValue({ status: 'ready' });
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

  it('T185/T187: renders the Teams personal tab entry point at the default my-work landing destination', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue(readyAuthState);

    const result = await TeamsTabPage({
      searchParams: Promise.resolve({}),
    });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(resolveTeamsTabAccessStateMock).toHaveBeenCalledWith(
      readyAuthState,
      { type: 'my_work' }
    );
    expect((result as any)?.props?.['data-teams-tab-state']).toBe('ready');
    expect((result as any)?.props?.['data-teams-tab-destination']).toBe('my_work');
  });

  it('T169/T189/T199: bootstraps a ticket deep link without a second PSA sign-in prompt and renders enough record context to confirm the ticket destination', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue(readyAuthState);

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
    expect(resolveTeamsTabAccessStateMock).toHaveBeenCalledWith(readyAuthState, { type: 'ticket', ticketId: '12345' });
    expect((result as any)?.props?.['data-teams-tab-state']).toBe('ready');
    expect((result as any)?.props?.['data-teams-tab-destination']).toBe('ticket');
    expect(collectNormalizedText(result)).toContain('Ticket 12345');
    expect(collectNormalizedText(result)).toContain("You're opening ticket 12345 from Teams.");
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

  it('T181: keeps not-configured tenant state distinct from unauthenticated and forbidden Teams tab states', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      message: 'Teams is not configured for this tenant',
    });

    const result = await TeamsTabPage({
      searchParams: Promise.resolve({
        tenantId: 'tenant-1',
      }),
    });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(resolveTeamsTabAccessStateMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(CardMock);
  });

  it('T178/T190/T201: falls back to the my-work landing with explanatory messaging when a requested ticket is unavailable after Teams authentication succeeds', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue(readyAuthState);
    resolveTeamsTabAccessStateMock.mockResolvedValue({
      status: 'forbidden',
      reason: 'not_found',
      message: 'That ticket is unavailable or you no longer have access to it.',
    });

    const result = await TeamsTabPage({
      searchParams: Promise.resolve({
        context: JSON.stringify({ page: 'ticket', ticketId: '12345' }),
      }),
    });

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as any)?.props?.['data-teams-tab-destination']).toBe('my_work');
    expect((result as any)?.props?.['data-teams-tab-requested-destination']).toBe('ticket');
    expect((result as any)?.props?.['data-teams-tab-fallback']).toBe('my_work');
    expect(collectNormalizedText(result)).toContain('Requested Teams record unavailable');
    expect(collectNormalizedText(result)).toContain('That ticket is unavailable or you no longer have access to it.');
    expect(collectNormalizedText(result)).toContain('You landed on your Teams work list instead of ticket 12345');
  });

  it('T191/T193/T195/T197: renders project-task, approval, time-entry, and contact destinations from Teams deep-link context', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue(readyAuthState);

    const projectTaskResult = await TeamsTabPage({
      searchParams: Promise.resolve({
        context: JSON.stringify({ page: 'project_task', projectId: 'project-44', taskId: 'task-88' }),
      }),
    });
    expect(resolveTeamsTabAccessStateMock).toHaveBeenNthCalledWith(1, readyAuthState, {
      type: 'project_task',
      projectId: 'project-44',
      taskId: 'task-88',
    });
    expect(collectNormalizedText(projectTaskResult)).toContain('Project task task-88');
    expect(collectNormalizedText(projectTaskResult)).toContain("You're opening task task-88 in project project-44.");

    const approvalResult = await TeamsTabPage({
      searchParams: Promise.resolve({
        context: JSON.stringify({ page: 'approval', approvalId: 'approval-2' }),
      }),
    });
    expect(resolveTeamsTabAccessStateMock).toHaveBeenNthCalledWith(2, readyAuthState, {
      type: 'approval',
      approvalId: 'approval-2',
    });
    expect(collectNormalizedText(approvalResult)).toContain('Approval approval-2');

    const timeEntryResult = await TeamsTabPage({
      searchParams: Promise.resolve({
        context: JSON.stringify({ page: 'time_entry', entryId: 'entry-9' }),
      }),
    });
    expect(resolveTeamsTabAccessStateMock).toHaveBeenNthCalledWith(3, readyAuthState, {
      type: 'time_entry',
      entryId: 'entry-9',
    });
    expect(collectNormalizedText(timeEntryResult)).toContain('Time entry entry-9');

    const contactResult = await TeamsTabPage({
      searchParams: Promise.resolve({
        context: JSON.stringify({ page: 'contact', contactId: 'contact-5', clientId: 'client-9' }),
      }),
    });
    expect(resolveTeamsTabAccessStateMock).toHaveBeenNthCalledWith(4, readyAuthState, {
      type: 'contact',
      contactId: 'contact-5',
      clientId: 'client-9',
    });
    expect(collectNormalizedText(contactResult)).toContain('Contact contact-5');
    expect(collectNormalizedText(contactResult)).toContain("You're opening contact contact-5 for client client-9 from Teams.");
  });

  it('T192/T194/T196/T198/T202: falls back to my-work when project-task, approval, time-entry, or contact deep links resolve to unavailable records', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue(readyAuthState);
    resolveTeamsTabAccessStateMock
      .mockResolvedValueOnce({
        status: 'forbidden',
        reason: 'not_found',
        message: 'That project task is unavailable or no longer matches this Teams link.',
      })
      .mockResolvedValueOnce({
        status: 'forbidden',
        reason: 'not_found',
        message: 'That approval item is unavailable or you no longer have access to it.',
      })
      .mockResolvedValueOnce({
        status: 'forbidden',
        reason: 'not_found',
        message: 'That time entry is unavailable or you no longer have access to it.',
      })
      .mockResolvedValueOnce({
        status: 'forbidden',
        reason: 'not_found',
        message: 'That contact is unavailable or you no longer have access to it.',
      });

    const projectTaskResult = await TeamsTabPage({
      searchParams: Promise.resolve({
        context: JSON.stringify({ page: 'project_task', projectId: 'project-44', taskId: 'task-88' }),
      }),
    });
    expect((projectTaskResult as any)?.props?.['data-teams-tab-destination']).toBe('my_work');
    expect(collectNormalizedText(projectTaskResult)).toContain(
      'That project task is unavailable or no longer matches this Teams link.'
    );

    const approvalResult = await TeamsTabPage({
      searchParams: Promise.resolve({
        context: JSON.stringify({ page: 'approval', approvalId: 'approval-2' }),
      }),
    });
    expect((approvalResult as any)?.props?.['data-teams-tab-destination']).toBe('my_work');
    expect(collectNormalizedText(approvalResult)).toContain(
      'That approval item is unavailable or you no longer have access to it.'
    );

    const timeEntryResult = await TeamsTabPage({
      searchParams: Promise.resolve({
        context: JSON.stringify({ page: 'time_entry', entryId: 'entry-9' }),
      }),
    });
    expect((timeEntryResult as any)?.props?.['data-teams-tab-destination']).toBe('my_work');
    expect(collectNormalizedText(timeEntryResult)).toContain(
      'That time entry is unavailable or you no longer have access to it.'
    );

    const contactResult = await TeamsTabPage({
      searchParams: Promise.resolve({
        context: JSON.stringify({ page: 'contact', contactId: 'contact-5', clientId: 'client-9' }),
      }),
    });
    expect((contactResult as any)?.props?.['data-teams-tab-destination']).toBe('my_work');
    expect(collectNormalizedText(contactResult)).toContain(
      'That contact is unavailable or you no longer have access to it.'
    );
  });
});
