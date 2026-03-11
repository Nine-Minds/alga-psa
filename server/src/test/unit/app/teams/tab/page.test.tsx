import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const redirectMock = vi.fn();
const resolveTeamsTabAuthStateMock = vi.fn();
const resolveTeamsTabAccessStateMock = vi.fn();
const getTeamsAvailabilityMock = vi.fn();
const CardMock = vi.fn((props: { children?: React.ReactNode }) => null);

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: CardMock,
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/resolveTeamsTabAuthState', () => ({
  resolveTeamsTabAuthState: (...args: unknown[]) => resolveTeamsTabAuthStateMock(...args),
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/resolveTeamsTabAccessState', () => ({
  resolveTeamsTabAccessState: (...args: unknown[]) => resolveTeamsTabAccessStateMock(...args),
}));

vi.mock('@alga-psa/integrations/lib/teamsAvailability', () => ({
  getTeamsAvailability: (...args: unknown[]) => getTeamsAvailabilityMock(...args),
}));

const { default: TeamsTabPage } = await import('../../../../../../../ee/server/src/app/teams/tab/page');

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

function collectHrefs(node: React.ReactNode): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((entry) => collectHrefs(entry));
  }

  if (React.isValidElement(node)) {
    const href = typeof node.props.href === 'string' ? [node.props.href] : [];
    return [...href, ...collectHrefs(node.props.children)];
  }

  return [];
}

function collectDataProp(node: React.ReactNode, key: string): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((entry) => collectDataProp(entry, key));
  }

  if (React.isValidElement(node)) {
    const value = typeof node.props[key] === 'string' ? [node.props[key]] : [];
    return [...value, ...collectDataProp(node.props.children, key)];
  }

  return [];
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
    getTeamsAvailabilityMock.mockReset();
    resolveTeamsTabAccessStateMock.mockResolvedValue({ status: 'ready' });
    getTeamsAvailabilityMock.mockResolvedValue({
      enabled: true,
      reason: 'enabled',
      flagKey: 'teams-integration-ui',
    });
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

  it('T115/T423: renders a disabled Teams shell when the tenant flag is off', async () => {
    getTeamsAvailabilityMock.mockResolvedValue({
      enabled: false,
      reason: 'flag_disabled',
      flagKey: 'teams-integration-ui',
      message: 'Microsoft Teams integration is disabled for this tenant.',
    });

    const result = await TeamsTabPage({
      searchParams: Promise.resolve({
        tenantId: 'tenant-1',
      }),
    });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(resolveTeamsTabAuthStateMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(CardMock);
    expect(collectNormalizedText(result)).toContain('Teams integration disabled');
    expect(collectNormalizedText(result)).toContain('Microsoft Teams integration is disabled for this tenant.');
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
    expect(collectNormalizedText(result)).toContain('Open in full PSA');
    expect(collectHrefs(result)).toContain('/msp/tickets/12345');
    expect(collectDataProp(result, 'data-teams-embedded-psa')).toContain('/msp/tickets/12345');
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
    expect(collectNormalizedText(result)).toContain('Teams setup not finished');
    expect(collectNormalizedText(result)).toContain(
      'Ask a PSA administrator to finish Teams setup and then reopen the personal tab.'
    );
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
    expect(collectHrefs(result)).toContain('/msp/tickets/12345');
    expect(collectDataProp(result, 'data-teams-embedded-psa')).toEqual([]);
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

  it('T212: falls back safely when an activity-feed notification link resolves to an unavailable Teams tab destination after authentication succeeds', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue(readyAuthState);
    resolveTeamsTabAccessStateMock.mockResolvedValue({
      status: 'forbidden',
      reason: 'not_found',
      message: 'That ticket is unavailable or you no longer have access to it.',
    });

    const result = await TeamsTabPage({
      searchParams: Promise.resolve({
        notificationLink: '/msp/tickets/ticket-123',
      }),
    });

    expect(resolveTeamsTabAccessStateMock).toHaveBeenCalledWith(readyAuthState, {
      type: 'ticket',
      ticketId: 'ticket-123',
    });
    expect((result as any)?.props?.['data-teams-tab-destination']).toBe('my_work');
    expect((result as any)?.props?.['data-teams-tab-requested-destination']).toBe('ticket');
    expect(collectNormalizedText(result)).toContain('Requested Teams record unavailable');
    expect(collectNormalizedText(result)).toContain('You landed on your Teams work list instead of ticket ticket-123');
  });

  it('T213/T215/T219: opens bot-result and message-extension-result links on the correct tab destination and keeps the full-PSA escalation path visible', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue(readyAuthState);

    const botResult = await TeamsTabPage({
      searchParams: Promise.resolve({
        botResultLink: '/msp/tickets/ticket-123',
      }),
    });

    expect(resolveTeamsTabAccessStateMock).toHaveBeenNthCalledWith(1, readyAuthState, {
      type: 'ticket',
      ticketId: 'ticket-123',
    });
    expect((botResult as any)?.props?.['data-teams-tab-destination']).toBe('ticket');
    expect((botResult as any)?.props?.['data-teams-tab-entry-source']).toBe('bot');
    expect(collectNormalizedText(botResult)).toContain('This record was opened from a Teams bot result.');
    expect(collectNormalizedText(botResult)).toContain(
      'Use the full PSA view when this workflow needs more context than a Teams card or quick action can provide.'
    );
    expect(collectHrefs(botResult)).toContain('/msp/tickets/ticket-123');

    const messageExtensionResult = await TeamsTabPage({
      searchParams: Promise.resolve({
        messageExtensionResultLink: '/msp/contacts/contact-5?clientId=client-9',
      }),
    });

    expect(resolveTeamsTabAccessStateMock).toHaveBeenNthCalledWith(2, readyAuthState, {
      type: 'contact',
      contactId: 'contact-5',
      clientId: 'client-9',
    });
    expect((messageExtensionResult as any)?.props?.['data-teams-tab-destination']).toBe('contact');
    expect((messageExtensionResult as any)?.props?.['data-teams-tab-entry-source']).toBe('message_extension');
    expect(collectNormalizedText(messageExtensionResult)).toContain(
      'This record was opened from a Teams message extension result.'
    );
    expect(collectHrefs(messageExtensionResult)).toContain('/msp/contacts/contact-5');
  });

  it('T214/T216/T218/T220: keeps bot-result, message-extension-result, and cold-start setup failures on safe Teams surfaces', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValueOnce(readyAuthState);
    resolveTeamsTabAccessStateMock.mockResolvedValueOnce({
      status: 'forbidden',
      reason: 'not_found',
      message: 'That ticket is unavailable or you no longer have access to it.',
    });

    const botFallback = await TeamsTabPage({
      searchParams: Promise.resolve({
        botResultLink: '/msp/tickets/ticket-123',
      }),
    });

    expect((botFallback as any)?.props?.['data-teams-tab-destination']).toBe('my_work');
    expect((botFallback as any)?.props?.['data-teams-tab-entry-source']).toBe('bot');
    expect(collectNormalizedText(botFallback)).toContain('Requested Teams record unavailable');

    resolveTeamsTabAuthStateMock.mockResolvedValueOnce(readyAuthState);
    resolveTeamsTabAccessStateMock.mockResolvedValueOnce({
      status: 'forbidden',
      reason: 'not_found',
      message: 'That contact is unavailable or you no longer have access to it.',
    });

    const messageExtensionFallback = await TeamsTabPage({
      searchParams: Promise.resolve({
        messageExtensionResultLink: '/msp/contacts/contact-5?clientId=client-9',
      }),
    });

    expect((messageExtensionFallback as any)?.props?.['data-teams-tab-destination']).toBe('my_work');
    expect((messageExtensionFallback as any)?.props?.['data-teams-tab-entry-source']).toBe('message_extension');
    expect(collectNormalizedText(messageExtensionFallback)).toContain(
      'That contact is unavailable or you no longer have access to it.'
    );

    resolveTeamsTabAuthStateMock.mockResolvedValueOnce({
      status: 'not_configured',
      tenantId: 'tenant-1',
      message: 'Teams is not configured for this tenant',
    });

    const coldStart = await TeamsTabPage({
      searchParams: Promise.resolve({}),
    });

    expect((coldStart as any)?.type).toBe(CardMock);
    expect(collectNormalizedText(coldStart)).toContain('Teams setup not finished');
    expect(collectNormalizedText(coldStart)).toContain('Teams is not configured for this tenant');
  });
});
