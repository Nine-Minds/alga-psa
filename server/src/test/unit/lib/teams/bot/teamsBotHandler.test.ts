import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  handleTeamsBotActivity,
  handleTeamsBotActivityRequest,
  type TeamsBotActivity,
} from '../../../../../../../ee/server/src/lib/teams/bot/teamsBotHandler';

const {
  resolveTeamsTenantContextMock,
  resolveTeamsLinkedUserMock,
  getUserWithRolesMock,
  createTenantKnexMock,
  hasPermissionMock,
  getTeamsIntegrationExecutionStateMock,
  executeTeamsActionMock,
  listAvailableTeamsActionsMock,
  getTeamsRuntimeAvailabilityMock,
} = vi.hoisted(() => ({
  resolveTeamsTenantContextMock: vi.fn(),
  resolveTeamsLinkedUserMock: vi.fn(),
  getUserWithRolesMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  getTeamsIntegrationExecutionStateMock: vi.fn(),
  executeTeamsActionMock: vi.fn(),
  listAvailableTeamsActionsMock: vi.fn(),
  getTeamsRuntimeAvailabilityMock: vi.fn(),
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/resolveTeamsTenantContext', () => ({
  resolveTeamsTenantContext: resolveTeamsTenantContextMock,
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/resolveTeamsLinkedUser', () => ({
  resolveTeamsLinkedUser: resolveTeamsLinkedUserMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  getUserWithRoles: getUserWithRolesMock,
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('../../../../../../../ee/server/src/lib/actions/integrations/teamsActions', () => ({
  getTeamsIntegrationExecutionStateImpl: getTeamsIntegrationExecutionStateMock,
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/actions/teamsActionRegistry', () => ({
  executeTeamsAction: executeTeamsActionMock,
  listAvailableTeamsActions: listAvailableTeamsActionsMock,
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/getTeamsRuntimeAvailability', () => ({
  getTeamsRuntimeAvailability: (...args: unknown[]) => getTeamsRuntimeAvailabilityMock(...args),
}));

function buildUser(overrides: Partial<IUserWithRoles> = {}): IUserWithRoles {
  return {
    user_id: 'user-1',
    tenant: 'tenant-1',
    user_type: 'internal',
    first_name: 'Alex',
    last_name: 'Tech',
    email: 'alex@example.test',
    username: 'alex@example.test',
    roles: [],
    permissions: [],
    ...overrides,
  } as IUserWithRoles;
}

function buildPersonalMessageActivity(text: string): TeamsBotActivity {
  return {
    type: 'message',
    text,
    from: {
      aadObjectId: 'aad-user-1',
      name: 'Alex Tech',
    },
    conversation: {
      id: 'conversation-1',
      conversationType: 'personal',
    },
    channelData: {
      tenant: {
        id: 'entra-tenant-1',
      },
    },
  };
}

describe('teamsBotHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    resolveTeamsTenantContextMock.mockResolvedValue({
      status: 'resolved',
      tenantId: 'tenant-1',
      installStatus: 'active',
      enabledCapabilities: ['personal_bot', 'personal_tab', 'message_extension'],
      appId: 'teams-app-1',
      botId: 'teams-app-1',
      microsoftTenantId: 'entra-tenant-1',
    });
    resolveTeamsLinkedUserMock.mockResolvedValue({
      status: 'linked',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userEmail: 'alex@example.test',
      username: 'alex',
      providerAccountId: 'aad-user-1',
      matchedBy: 'provider_account_id',
    });
    getUserWithRolesMock.mockResolvedValue(buildUser());
    hasPermissionMock.mockResolvedValue(true);
    getTeamsIntegrationExecutionStateMock.mockResolvedValue({
      selectedProfileId: 'profile-1',
      installStatus: 'active',
      enabledCapabilities: ['personal_bot', 'personal_tab', 'message_extension'],
      allowedActions: ['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response'],
      appId: 'teams-app-1',
      packageMetadata: {
        baseUrl: 'https://example.test',
      },
    });
    listAvailableTeamsActionsMock.mockResolvedValue([]);
    getTeamsRuntimeAvailabilityMock.mockResolvedValue(null);
    createTenantKnexMock.mockResolvedValue({
      knex: Object.assign(
        vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue([]),
        })),
        {
          from: vi.fn(),
        }
      ),
    });
  });

  it('T255/T259: returns welcome and help responses that list the currently supported bot commands for the tenant', async () => {
    const welcome = await handleTeamsBotActivity(
      {
        ...buildPersonalMessageActivity(''),
        type: 'conversationUpdate',
      },
      { tenantIdHint: 'tenant-1' }
    );

    expect(welcome.text).toContain('Alga PSA is ready');
    expect(welcome.attachments?.[0]?.content.title).toBe('Teams bot commands');
    expect(welcome.attachments?.[0]?.content.text).toContain('my tickets');
    expect(welcome.attachments?.[0]?.content.text).toContain('my approvals');
    expect(welcome.attachments?.[0]?.content.text).toContain('ticket <id>');
    expect(welcome.attachments?.[0]?.content.text).toContain('assign ticket <ticket-id> to me');
    expect(welcome.suggestedActions?.actions.map((action) => action.value)).toContain('my tickets');

    const help = await handleTeamsBotActivity(buildPersonalMessageActivity('help'), { tenantIdHint: 'tenant-1' });

    expect(help.attachments?.[0]?.content.text).toContain('add note <ticket-id>: <note>');
    expect(help.attachments?.[0]?.content.text).toContain('reply to contact <ticket-id>: <reply>');
    expect(help.attachments?.[0]?.content.text).toContain('log time ticket <ticket-id> 30m: <note>');
    expect(help.attachments?.[0]?.content.text).toContain('approve approval <approval-id>');
    expect(help.metadata?.commandId).toBe('help');
  });

  it('T257/T258: unsupported commands return recoverable help guidance instead of a dead end', async () => {
    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('close every ticket'), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.text).toContain('not supported');
    expect(response.attachments?.[0]?.content.text).toContain('my tickets');
    expect(response.suggestedActions?.actions.map((action) => action.value)).toContain('ticket <id>');
  });

  it('T267/T268: non-personal Teams contexts return a clear personal-scope-only response', async () => {
    const response = await handleTeamsBotActivity(
      {
        ...buildPersonalMessageActivity('my tickets'),
        conversation: {
          id: 'conversation-2',
          conversationType: 'channel',
        },
      },
      { tenantIdHint: 'tenant-1' }
    );

    expect(response.text).toContain('personal chats');
    expect(response.attachments?.[0]?.content.title).toBe('Personal scope only');
  });

  it('T261/T263/T265: ticket lookups render cards with Teams/PSA buttons and only tenant-allowed follow-up command shortcuts for the resolved ticket', async () => {
    executeTeamsActionMock.mockResolvedValue({
      success: true,
      actionId: 'open_record',
      surface: 'bot',
      operation: 'lookup',
      summary: {
        title: 'Ticket T-1001',
        text: 'Broken VPN • In progress • High',
      },
      links: [
        { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-1001' },
        { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-1001' },
      ],
      items: [
        {
          id: 'ticket-1001',
          title: 'Ticket T-1001',
          summary: 'Broken VPN • In progress • High',
          entityType: 'ticket',
          links: [
            { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-1001' },
            { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-1001' },
          ],
        },
      ],
      target: {
        entityType: 'ticket',
        id: 'ticket-1001',
        destination: {
          type: 'ticket',
          ticketId: 'ticket-1001',
        },
      },
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TicketService.getById'],
      },
    });
    listAvailableTeamsActionsMock.mockResolvedValue([
      {
        actionId: 'assign_ticket',
        operation: 'mutation',
        available: true,
        targetEntityTypes: ['ticket'],
        requiredInputs: [],
        businessOperations: ['TicketService.update'],
      },
      {
        actionId: 'add_note',
        operation: 'mutation',
        available: true,
        targetEntityTypes: ['ticket'],
        requiredInputs: [],
        businessOperations: ['TicketService.addComment'],
      },
      {
        actionId: 'reply_to_contact',
        operation: 'mutation',
        available: false,
        targetEntityTypes: ['ticket'],
        requiredInputs: [],
        businessOperations: ['TicketService.addComment'],
        reason: 'capability_disabled',
        message: 'This Teams quick action is disabled for the tenant.',
      },
    ]);

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('ticket ticket-1001'), {
      tenantIdHint: 'tenant-1',
    });

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'open_record',
        target: {
          entityType: 'ticket',
          ticketId: 'ticket-1001',
        },
      })
    );
    expect(response.attachments?.[0]?.content.buttons).toEqual([
      expect.objectContaining({ type: 'openUrl', value: 'https://teams.test/ticket-1001' }),
      expect.objectContaining({ type: 'openUrl', value: '/msp/tickets/ticket-1001' }),
    ]);
    expect(response.attachments?.[1]?.content.buttons).toEqual([
      expect.objectContaining({ type: 'openUrl', value: 'https://teams.test/ticket-1001' }),
      expect.objectContaining({ type: 'openUrl', value: '/msp/tickets/ticket-1001' }),
      expect.objectContaining({ type: 'imBack', value: 'assign ticket ticket-1001' }),
      expect.objectContaining({ type: 'imBack', value: 'add note ticket-1001' }),
    ]);
    expect(response.attachments?.[1]?.content.buttons).not.toContainEqual(
      expect.objectContaining({ value: 'reply to contact ticket-1001' })
    );
  });

  it('T280/T282/T284/T286: `assign ticket` validates missing targets and assignee lookup failures with recoverable bot responses', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const missingTarget = await handleTeamsBotActivity(buildPersonalMessageActivity('assign ticket'), {
      tenantIdHint: 'tenant-1',
    });

    expect(missingTarget.text).toContain('Specify a ticket reference');

    const lookupForbidden = await handleTeamsBotActivity(
      buildPersonalMessageActivity('assign ticket ticket-2002 to Casey Chen'),
      {
        tenantIdHint: 'tenant-1',
      }
    );

    expect(hasPermissionMock).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'user', 'read', expect.anything());
    expect(lookupForbidden.text).toContain('requires PSA permission to read users');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T279/T281/T283/T285/T213: `assign ticket` resolves the ticket, resolves the assignee, executes the shared mutation, and returns Teams tab links in the result', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue([
          {
            user_id: 'user-2',
            username: 'casey@example.test',
            email: 'casey@example.test',
            first_name: 'Casey',
            last_name: 'Chen',
          },
        ]),
      })),
    });
    executeTeamsActionMock.mockResolvedValue({
      success: true,
      actionId: 'assign_ticket',
      surface: 'bot',
      operation: 'mutation',
      summary: {
        title: 'Ticket assigned',
        text: 'Ticket ticket-2002 was reassigned successfully.',
      },
      links: [
        { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-2002' },
        { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-2002' },
      ],
      items: [
        {
          id: 'ticket-2002',
          title: 'Ticket T-2002',
          summary: 'Printer jam • Waiting on client',
          entityType: 'ticket',
          links: [
            { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-2002' },
            { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-2002' },
          ],
        },
      ],
      target: {
        entityType: 'ticket',
        id: 'ticket-2002',
        destination: {
          type: 'ticket',
          ticketId: 'ticket-2002',
        },
      },
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TicketService.getById'],
      },
    });

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('assign ticket ticket-2002 to Casey Chen'), {
      tenantIdHint: 'tenant-1',
    });

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'assign_ticket',
        input: {
          ticketId: 'ticket-2002',
          assigneeId: 'user-2',
        },
        target: {
          entityType: 'ticket',
          ticketId: 'ticket-2002',
        },
      })
    );
    expect(response.text).toContain('assigned to Casey Chen');
    expect(response.attachments?.[0]?.content.buttons).toContainEqual(
      expect.objectContaining({ type: 'openUrl', value: 'https://teams.test/ticket-2002' })
    );
    expect(response.attachments?.[1]?.content.buttons).toContainEqual(
      expect.objectContaining({ type: 'openUrl', value: 'https://teams.test/ticket-2002' })
    );
  });

  it('T214: failed bot action results fall back safely instead of returning an unusable tab handoff', async () => {
    executeTeamsActionMock.mockResolvedValue({
      success: false,
      actionId: 'assign_ticket',
      surface: 'bot',
      operation: 'mutation',
      error: {
        code: 'not_found',
        message: 'Ticket ticket-missing was not found.',
        remediation: 'Refresh the Teams result or open the full PSA application to verify the record still exists.',
      },
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TicketService.update'],
      },
    });

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('assign ticket ticket-missing'), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.text).toContain('not found');
    expect(response.attachments?.[0]?.content.title).toBe('Teams bot request unavailable');
  });

  it('T288/T290: `add note` validates missing targets and missing note content with recoverable guidance', async () => {
    const missingTarget = await handleTeamsBotActivity(buildPersonalMessageActivity('add note'), {
      tenantIdHint: 'tenant-1',
    });

    expect(missingTarget.text).toContain('Specify a ticket reference');

    const missingNote = await handleTeamsBotActivity(buildPersonalMessageActivity('add note ticket-2002'), {
      tenantIdHint: 'tenant-1',
    });

    expect(missingNote.text).toContain('add note ticket-2002:');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T287/T289/T291/T292: `add note` resolves the ticket, executes the shared mutation, and returns follow-up links after success', async () => {
    executeTeamsActionMock.mockResolvedValue({
      success: true,
      actionId: 'add_note',
      surface: 'bot',
      operation: 'mutation',
      summary: {
        title: 'Internal note added',
        text: 'A new internal note was added to ticket ticket-2002.',
      },
      links: [
        { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-2002' },
        { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-2002' },
      ],
      items: [],
      target: {
        entityType: 'ticket',
        id: 'ticket-2002',
        destination: {
          type: 'ticket',
          ticketId: 'ticket-2002',
        },
      },
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TicketService.addComment'],
      },
    });

    const response = await handleTeamsBotActivity(
      buildPersonalMessageActivity('add note ticket-2002: Waiting on the vendor'),
      {
        tenantIdHint: 'tenant-1',
      }
    );

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'add_note',
        input: {
          ticketId: 'ticket-2002',
          note: 'Waiting on the vendor',
        },
      })
    );
    expect(response.text).toContain('internal note was added');
    expect(response.attachments?.[0]?.content.buttons).toContainEqual(
      expect.objectContaining({ type: 'openUrl', value: 'https://teams.test/ticket-2002' })
    );
  });

  it('T294/T296: `reply to contact` validates missing targets and missing reply content with recoverable guidance', async () => {
    const missingTarget = await handleTeamsBotActivity(buildPersonalMessageActivity('reply to contact'), {
      tenantIdHint: 'tenant-1',
    });

    expect(missingTarget.text).toContain('Specify a ticket reference');

    const missingReply = await handleTeamsBotActivity(buildPersonalMessageActivity('reply to contact ticket-2002'), {
      tenantIdHint: 'tenant-1',
    });

    expect(missingReply.text).toContain('reply to contact ticket-2002:');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T293/T295/T297/T298: `reply to contact` resolves the ticket, executes the shared mutation, and returns follow-up links after success', async () => {
    executeTeamsActionMock.mockResolvedValue({
      success: true,
      actionId: 'reply_to_contact',
      surface: 'bot',
      operation: 'mutation',
      summary: {
        title: 'Reply sent',
        text: 'A customer-visible reply was added to ticket ticket-2002.',
      },
      links: [
        { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-2002' },
        { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-2002' },
      ],
      items: [],
      target: {
        entityType: 'ticket',
        id: 'ticket-2002',
        destination: {
          type: 'ticket',
          ticketId: 'ticket-2002',
        },
      },
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TicketService.addComment'],
      },
    });

    const response = await handleTeamsBotActivity(
      buildPersonalMessageActivity('reply to contact ticket-2002: I have an update for you.'),
      {
        tenantIdHint: 'tenant-1',
      }
    );

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'reply_to_contact',
        input: {
          ticketId: 'ticket-2002',
          reply: 'I have an update for you.',
        },
      })
    );
    expect(response.text).toContain('customer-visible reply');
    expect(response.attachments?.[0]?.content.buttons).toContainEqual(
      expect.objectContaining({ type: 'openUrl', value: 'https://teams.test/ticket-2002' })
    );
  });

  it('T300/T302/T304: `log time` validates missing work items and missing durations with recoverable guidance', async () => {
    const missingTarget = await handleTeamsBotActivity(buildPersonalMessageActivity('log time'), {
      tenantIdHint: 'tenant-1',
    });

    expect(missingTarget.text).toContain('Specify a work item');

    const missingDuration = await handleTeamsBotActivity(buildPersonalMessageActivity('log time ticket ticket-2002'), {
      tenantIdHint: 'tenant-1',
    });

    expect(missingDuration.text).toContain('log time ticket ticket-2002 30m');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T299/T303: `log time` logs time against a ticket with duration, note, and Teams follow-up links', async () => {
    executeTeamsActionMock.mockResolvedValue({
      success: true,
      actionId: 'log_time',
      surface: 'bot',
      operation: 'mutation',
      summary: {
        title: 'Time logged',
        text: 'Logged 30 minutes from Teams.',
      },
      links: [
        { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-2002' },
        { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-2002' },
      ],
      items: [],
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TimeEntryService.create'],
      },
    });

    const response = await handleTeamsBotActivity(
      buildPersonalMessageActivity('log time ticket ticket-2002 30m: Investigated the issue'),
      {
        tenantIdHint: 'tenant-1',
      }
    );

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'log_time',
        input: expect.objectContaining({
          entityType: 'ticket',
          workItemId: 'ticket-2002',
          durationMinutes: 30,
          note: 'Investigated the issue',
          isBillable: true,
          startTime: expect.any(String),
        }),
      })
    );
    expect(response.text).toContain('Logged 30 minutes');
    expect(response.attachments?.[0]?.content.buttons).toContainEqual(
      expect.objectContaining({ type: 'openUrl', value: 'https://teams.test/ticket-2002' })
    );
  });

  it('T301: `log time` can target a project task with the same shared mutation path', async () => {
    executeTeamsActionMock.mockResolvedValue({
      success: true,
      actionId: 'log_time',
      surface: 'bot',
      operation: 'mutation',
      summary: {
        title: 'Time logged',
        text: 'Logged 60 minutes from Teams.',
      },
      links: [
        { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/task-2002' },
        { type: 'psa', label: 'Open in full PSA', url: '/msp/projects/proj-1/tasks/task-2002' },
      ],
      items: [],
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TimeEntryService.create'],
      },
    });

    await handleTeamsBotActivity(
      buildPersonalMessageActivity('log time task task-2002 1h: Worked the task'),
      {
        tenantIdHint: 'tenant-1',
      }
    );

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'log_time',
        target: {
          entityType: 'project_task',
          taskId: 'task-2002',
        },
        input: expect.objectContaining({
          entityType: 'project_task',
          workItemId: 'task-2002',
          durationMinutes: 60,
          note: 'Worked the task',
        }),
      })
    );
  });

  it('T269/T271/T273: `my tickets` returns ticket summaries with action links for the signed-in technician', async () => {
    executeTeamsActionMock.mockResolvedValue({
      success: true,
      actionId: 'my_tickets',
      surface: 'bot',
      operation: 'lookup',
      summary: {
        title: 'My tickets',
        text: 'Found 2 assigned tickets for the signed-in technician.',
      },
      links: [],
      items: [
        {
          id: 'ticket-1001',
          title: 'T-1001',
          summary: 'Broken VPN • In progress • High',
          entityType: 'ticket',
          links: [
            { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-1001' },
            { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-1001' },
          ],
        },
        {
          id: 'ticket-1002',
          title: 'T-1002',
          summary: 'Printer jam • Waiting on client • Medium',
          entityType: 'ticket',
          links: [
            { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-1002' },
            { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-1002' },
          ],
        },
      ],
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TicketService.list'],
      },
    });
    listAvailableTeamsActionsMock.mockResolvedValue([]);

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('my tickets'), {
      tenantIdHint: 'tenant-1',
    });

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'my_tickets',
        input: {
          limit: 5,
        },
      })
    );
    expect(response.text).toContain('Found 2 assigned tickets');
    expect(response.attachments?.[1]?.content.title).toBe('T-1001');
    expect(response.attachments?.[1]?.content.text).toContain('Broken VPN');
    expect(response.attachments?.[1]?.content.buttons).toContainEqual(
      expect.objectContaining({ type: 'openUrl', value: 'https://teams.test/ticket-1001' })
    );
    expect(response.attachments?.[1]?.content.buttons).toContainEqual(
      expect.objectContaining({ type: 'openUrl', value: '/msp/tickets/ticket-1001' })
    );
  });

  it('T305: `my approvals` returns pending approval summaries with Teams links and approval command shortcuts', async () => {
    executeTeamsActionMock.mockResolvedValue({
      success: true,
      actionId: 'my_approvals',
      surface: 'bot',
      operation: 'lookup',
      summary: {
        title: 'My approvals',
        text: 'Found 2 approval items ready for review in Teams.',
      },
      links: [],
      items: [
        {
          id: 'approval-1',
          title: 'Approval approval-1',
          summary: 'Taylor Nguyen • 2026-03-02 to 2026-03-08 • SUBMITTED',
          entityType: 'approval',
          links: [
            { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/approval-1' },
            { type: 'psa', label: 'Open in full PSA', url: '/msp/time-sheet-approvals?approvalId=approval-1' },
          ],
        },
        {
          id: 'approval-2',
          title: 'Approval approval-2',
          summary: 'Jamie Rivera • 2026-02-24 to 2026-03-01 • CHANGES_REQUESTED',
          entityType: 'approval',
          links: [
            { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/approval-2' },
            { type: 'psa', label: 'Open in full PSA', url: '/msp/time-sheet-approvals?approvalId=approval-2' },
          ],
        },
      ],
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TimeSheetApprovalQuery.listPendingApprovals'],
      },
    });
    listAvailableTeamsActionsMock.mockResolvedValue([
      {
        actionId: 'approval_response',
        operation: 'mutation',
        available: true,
        targetEntityTypes: ['approval'],
        requiredInputs: [],
        businessOperations: ['TimeSheetService.approveTimeSheet', 'TimeSheetService.requestChanges'],
      },
    ]);

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('my approvals'), {
      tenantIdHint: 'tenant-1',
    });

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'my_approvals',
        input: {
          limit: 5,
        },
      })
    );
    expect(response.text).toContain('Found 2 approval items');
    expect(response.attachments?.[1]?.content.buttons).toContainEqual(
      expect.objectContaining({ type: 'imBack', value: 'approve approval approval-1' })
    );
    expect(response.attachments?.[1]?.content.buttons).toContainEqual(
      expect.objectContaining({ type: 'imBack', value: 'request changes approval approval-1: <comment>' })
    );
  });

  it('T270/T272/T274: recoverable permission failures from `my tickets` remain user-readable inside Teams', async () => {
    executeTeamsActionMock.mockResolvedValue({
      success: false,
      actionId: 'my_tickets',
      surface: 'bot',
      operation: 'lookup',
      error: {
        code: 'forbidden',
        message: 'You do not have permission to view tickets from Teams.',
        remediation: 'Open the full PSA application if you need broader access.',
      },
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TicketService.list'],
      },
    });

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('my tickets'), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.text).toContain('You do not have permission');
    expect(response.attachments?.[0]?.content.text).toContain('Open the full PSA application');
  });

  it('T306: recoverable permission failures from `my approvals` remain user-readable inside Teams', async () => {
    executeTeamsActionMock.mockResolvedValue({
      success: false,
      actionId: 'my_approvals',
      surface: 'bot',
      operation: 'lookup',
      error: {
        code: 'forbidden',
        message: 'You do not have permission to view approvals from Teams.',
        remediation: 'Open the full PSA application if you need broader access.',
      },
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: ['TimeSheetApprovalQuery.listPendingApprovals'],
      },
    });

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('my approvals'), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.text).toContain('view approvals');
    expect(response.attachments?.[0]?.content.title).toBe('Teams bot request unavailable');
  });

  it('T307: approval commands execute approve and request-changes flows through the shared Teams action layer', async () => {
    executeTeamsActionMock
      .mockResolvedValueOnce({
        success: true,
        actionId: 'approval_response',
        surface: 'bot',
        operation: 'mutation',
        summary: {
          title: 'Approval completed',
          text: 'Approval approval-1 was approved successfully.',
        },
        links: [
          { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/approval-1' },
          { type: 'psa', label: 'Open in full PSA', url: '/msp/time-sheet-approvals?approvalId=approval-1' },
        ],
        items: [],
        target: {
          entityType: 'approval',
          id: 'approval-1',
          destination: {
            type: 'approval',
            approvalId: 'approval-1',
          },
        },
        warnings: [],
        metadata: {
          surface: 'bot',
          idempotencyKey: null,
          idempotentReplay: false,
          invokingSurface: 'bot',
          businessOperations: ['TimeSheetService.approveTimeSheet', 'TimeSheetService.requestChanges'],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        actionId: 'approval_response',
        surface: 'bot',
        operation: 'mutation',
        summary: {
          title: 'Changes requested',
          text: 'Approval approval-2 was returned with requested changes.',
        },
        links: [
          { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/approval-2' },
          { type: 'psa', label: 'Open in full PSA', url: '/msp/time-sheet-approvals?approvalId=approval-2' },
        ],
        items: [],
        target: {
          entityType: 'approval',
          id: 'approval-2',
          destination: {
            type: 'approval',
            approvalId: 'approval-2',
          },
        },
        warnings: [],
        metadata: {
          surface: 'bot',
          idempotencyKey: null,
          idempotentReplay: false,
          invokingSurface: 'bot',
          businessOperations: ['TimeSheetService.approveTimeSheet', 'TimeSheetService.requestChanges'],
        },
      });

    const approveResponse = await handleTeamsBotActivity(buildPersonalMessageActivity('approve approval approval-1'), {
      tenantIdHint: 'tenant-1',
    });
    const requestChangesResponse = await handleTeamsBotActivity(
      buildPersonalMessageActivity('reject approval approval-2: Please split Friday travel and labor.'),
      {
        tenantIdHint: 'tenant-1',
      }
    );

    expect(executeTeamsActionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actionId: 'approval_response',
        target: {
          entityType: 'approval',
          approvalId: 'approval-1',
        },
        input: {
          approvalId: 'approval-1',
          outcome: 'approve',
        },
      })
    );
    expect(executeTeamsActionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actionId: 'approval_response',
        target: {
          entityType: 'approval',
          approvalId: 'approval-2',
        },
        input: {
          approvalId: 'approval-2',
          outcome: 'request_changes',
          comment: 'Please split Friday travel and labor.',
        },
      })
    );
    expect(approveResponse.text).toContain('approved successfully');
    expect(requestChangesResponse.text).toContain('requested changes');
  });

  it('T308: approval commands validate missing approval IDs and required change-request comments with recoverable guidance', async () => {
    const missingTarget = await handleTeamsBotActivity(buildPersonalMessageActivity('approve approval'), {
      tenantIdHint: 'tenant-1',
    });

    expect(missingTarget.text).toContain('Specify an approval reference');

    const missingComment = await handleTeamsBotActivity(buildPersonalMessageActivity('request changes approval approval-2'), {
      tenantIdHint: 'tenant-1',
    });

    expect(missingComment.text).toContain('Add a comment');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T275/T277/T276/T278: `ticket <id>` returns a ticket summary when allowed and a clear not-found response when the reference is invalid', async () => {
    executeTeamsActionMock
      .mockResolvedValueOnce({
        success: true,
        actionId: 'open_record',
        surface: 'bot',
        operation: 'lookup',
        summary: {
          title: 'Ticket T-3003',
          text: 'Email outage • Awaiting vendor',
        },
        links: [
          { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-3003' },
          { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-3003' },
        ],
        items: [
          {
            id: 'ticket-3003',
            title: 'Ticket T-3003',
            summary: 'Email outage • Awaiting vendor',
            entityType: 'ticket',
            links: [
              { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-3003' },
              { type: 'psa', label: 'Open in full PSA', url: '/msp/tickets/ticket-3003' },
            ],
          },
        ],
        target: {
          entityType: 'ticket',
          id: 'ticket-3003',
          destination: {
            type: 'ticket',
            ticketId: 'ticket-3003',
          },
        },
        warnings: [],
        metadata: {
          surface: 'bot',
          idempotencyKey: null,
          idempotentReplay: false,
          invokingSurface: 'bot',
          businessOperations: ['TicketService.getById'],
        },
      })
      .mockResolvedValueOnce({
        success: false,
        actionId: 'open_record',
        surface: 'bot',
        operation: 'lookup',
        error: {
          code: 'not_found',
          message: 'Ticket ticket-missing was not found.',
          remediation: 'Refresh the Teams result or open the full PSA application to verify the record still exists.',
        },
        warnings: [],
        metadata: {
          surface: 'bot',
          idempotencyKey: null,
          idempotentReplay: false,
          invokingSurface: 'bot',
          businessOperations: ['TicketService.getById'],
        },
      });
    listAvailableTeamsActionsMock.mockResolvedValue([]);

    const success = await handleTeamsBotActivity(buildPersonalMessageActivity('ticket ticket-3003'), {
      tenantIdHint: 'tenant-1',
    });
    expect(success.attachments?.[0]?.content.title).toBe('Ticket T-3003');
    expect(success.attachments?.[0]?.content.text).toContain('Email outage');

    const notFound = await handleTeamsBotActivity(buildPersonalMessageActivity('ticket ticket-missing'), {
      tenantIdHint: 'tenant-1',
    });
    expect(notFound.text).toContain('not found');
    expect(notFound.attachments?.[0]?.content.title).toBe('Teams bot request unavailable');
  });

  it('T253/T254: request handling returns structured JSON responses and rejects malformed request bodies', async () => {
    const okRequest = new Request('https://example.test/api/teams/bot/messages?tenantId=tenant-1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildPersonalMessageActivity('help')),
    });

    const okResponse = await handleTeamsBotActivityRequest(okRequest);
    expect(okResponse.status).toBe(200);
    await expect(okResponse.json()).resolves.toMatchObject({
      type: 'message',
      metadata: {
        tenantId: 'tenant-1',
      },
    });

    const badRequest = new Request('https://example.test/api/teams/bot/messages?tenantId=tenant-1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{not-json}',
    });

    const badResponse = await handleTeamsBotActivityRequest(badRequest);
    expect(badResponse.status).toBe(400);
    await expect(badResponse.json()).resolves.toMatchObject({
      error: 'invalid_json',
    });
  });
});
