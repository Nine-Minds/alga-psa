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
  verifyTeamsBotRequestMock,
  searchTeamsTicketsMock,
  searchTeamsClientsByNameMock,
  listTeamsActiveClientsMock,
  getTeamsTicketCreationDefaultsMock,
  upsertTeamsConversationReferenceMock,
  saveTeamsConversationContextMock,
  getTeamsConversationContextMock,
  findTeamsConversationReferenceByConversationIdMock,
  sendBotActivityMock,
  updateBotActivityMock,
  isBotConnectorConfiguredMock,
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
  verifyTeamsBotRequestMock: vi.fn(),
  searchTeamsTicketsMock: vi.fn(),
  searchTeamsClientsByNameMock: vi.fn(),
  listTeamsActiveClientsMock: vi.fn(),
  getTeamsTicketCreationDefaultsMock: vi.fn(),
  upsertTeamsConversationReferenceMock: vi.fn(),
  saveTeamsConversationContextMock: vi.fn(),
  getTeamsConversationContextMock: vi.fn(),
  findTeamsConversationReferenceByConversationIdMock: vi.fn(),
  sendBotActivityMock: vi.fn(),
  updateBotActivityMock: vi.fn(),
  isBotConnectorConfiguredMock: vi.fn(),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotJwtVerifier', () => ({
  verifyTeamsBotRequest: verifyTeamsBotRequestMock,
  resetTeamsBotJwksCacheForTests: vi.fn(),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/resolveTeamsTenantContext', () => ({
  resolveTeamsTenantContext: resolveTeamsTenantContextMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/resolveTeamsLinkedUser', () => ({
  resolveTeamsLinkedUser: resolveTeamsLinkedUserMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  getUserWithRoles: getUserWithRolesMock,
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/actions/integrations/teamsActions', () => ({
  getTeamsIntegrationExecutionStateImpl: getTeamsIntegrationExecutionStateMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/actions/teamsActionRegistry', () => ({
  executeTeamsAction: executeTeamsActionMock,
  listAvailableTeamsActions: listAvailableTeamsActionsMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/getTeamsRuntimeAvailability', () => ({
  getTeamsRuntimeAvailability: (...args: unknown[]) => getTeamsRuntimeAvailabilityMock(...args),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/teamsPsaData', () => ({
  searchTeamsTickets: searchTeamsTicketsMock,
  searchTeamsClientsByName: searchTeamsClientsByNameMock,
  listTeamsActiveClients: listTeamsActiveClientsMock,
  getTeamsTicketCreationDefaults: getTeamsTicketCreationDefaultsMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsConversationReferences', () => ({
  upsertTeamsConversationReference: upsertTeamsConversationReferenceMock,
  saveTeamsConversationContext: saveTeamsConversationContextMock,
  getTeamsConversationContext: getTeamsConversationContextMock,
  findTeamsConversationReferenceByConversationId: findTeamsConversationReferenceByConversationIdMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotConnector', () => {
  class BotConnectorRequestError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    BotConnectorRequestError,
    isBotConnectorConfigured: (...args: unknown[]) => isBotConnectorConfiguredMock(...args),
    isTrustedServiceUrl: () => true,
    sendBotActivity: sendBotActivityMock,
    updateBotActivity: updateBotActivityMock,
  };
});

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

const ALL_ACTION_IDS = [
  'my_tickets',
  'my_approvals',
  'open_record',
  'create_ticket_from_message',
  'update_from_message',
  'assign_ticket',
  'add_note',
  'reply_to_contact',
  'log_time',
  'approval_response',
] as const;

function buildFullAvailability(overrides: Partial<Record<string, boolean>> = {}) {
  return ALL_ACTION_IDS.map((actionId) => ({
    actionId,
    operation: 'lookup' as const,
    available: overrides[actionId] ?? true,
    targetEntityTypes: [],
    requiredInputs: [],
    businessOperations: [],
  }));
}

function buildActionSuccess(actionId: string, overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    actionId,
    surface: 'bot',
    operation: 'lookup',
    summary: { title: 'OK', text: 'Command completed.' },
    links: [],
    items: [],
    warnings: [],
    metadata: {
      surface: 'bot',
      idempotencyKey: null,
      idempotentReplay: false,
      invokingSurface: 'bot',
      businessOperations: [],
    },
    ...overrides,
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
    // RBAC-aware help derives visibility from listAvailableTeamsActions, so
    // the default harness exposes every registry action as available.
    listAvailableTeamsActionsMock.mockResolvedValue(buildFullAvailability());
    getTeamsRuntimeAvailabilityMock.mockResolvedValue(null);
    verifyTeamsBotRequestMock.mockResolvedValue({ status: 'verified', payload: {} });
    searchTeamsTicketsMock.mockResolvedValue([]);
    searchTeamsClientsByNameMock.mockResolvedValue([]);
    listTeamsActiveClientsMock.mockResolvedValue([]);
    getTeamsTicketCreationDefaultsMock.mockResolvedValue({ boardId: 'board-1', statusId: 'status-1' });
    upsertTeamsConversationReferenceMock.mockResolvedValue(true);
    saveTeamsConversationContextMock.mockResolvedValue(true);
    getTeamsConversationContextMock.mockResolvedValue(null);
    findTeamsConversationReferenceByConversationIdMock.mockResolvedValue(null);
    sendBotActivityMock.mockResolvedValue({ status: 'sent' });
    updateBotActivityMock.mockResolvedValue({ status: 'sent' });
    isBotConnectorConfiguredMock.mockReturnValue(false);
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
    expect(welcome.attachments?.[0]?.content.text).toContain('ticket <number>');
    expect(welcome.attachments?.[0]?.content.text).toContain('assign ticket <number> to me');
    expect(welcome.suggestedActions?.actions.map((action) => action.value)).toContain('my tickets');

    const help = await handleTeamsBotActivity(buildPersonalMessageActivity('help'), { tenantIdHint: 'tenant-1' });

    expect(help.attachments?.[0]?.content.text).toContain('add note <number>: <note>');
    expect(help.attachments?.[0]?.content.text).toContain('reply to contact <number>: <reply>');
    expect(help.attachments?.[0]?.content.text).toContain('log time ticket <number> 30m: <note>');
    // Command examples now come from the shared TEAMS_BOT_COMMAND_DEFINITIONS
    // module, which uses "approve approval <n>" (ordinal-friendly syntax).
    expect(help.attachments?.[0]?.content.text).toContain('approve approval <n>');
    expect(help.attachments?.[0]?.content.text).toContain('new ticket <title>');
    expect(help.metadata?.commandId).toBe('help');
  });

  it('T257/T258: unsupported commands return recoverable help guidance instead of a dead end', async () => {
    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('close every ticket'), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.text).toContain('not supported');
    expect(response.attachments?.[0]?.content.text).toContain('my tickets');
    expect(response.suggestedActions?.actions.map((action) => action.value)).toContain('ticket <number>');
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

    expect(response.text).toContain('personal and group chats');
    expect(response.attachments?.[0]?.content.title).toBe('Unsupported conversation type');
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
        andWhere: vi.fn().mockReturnThis(),
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
    // List results are numbered (F035) so follow-up ordinals ("ticket 2") work.
    expect(response.attachments?.[1]?.content.title).toBe('1. T-1001');
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

    // Non-identifier text now falls back to title search (F034), so the
    // invalid-reference case uses a numeric reference to stay on the direct
    // lookup path.
    const notFound = await handleTeamsBotActivity(buildPersonalMessageActivity('ticket 999999'), {
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
    // Teams ignores the HTTP body for message activities; replies are sent via
    // the Bot Framework connector, so the endpoint just acknowledges receipt.
    await expect(okResponse.json()).resolves.toMatchObject({
      status: 'ok',
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

  it('T056/T057: unlinked users get a sign-in card whose deep link carries tenant and conversation context', async () => {
    resolveTeamsLinkedUserMock.mockResolvedValue({
      status: 'not_found',
      tenantId: 'tenant-1',
      message: 'No Microsoft account link matches this Teams user for the current tenant.',
    });

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('my tickets'), {
      tenantIdHint: 'tenant-1',
    });

    const card = response.attachments?.[0]?.content;
    expect(card?.title).toBe('Teams sign-in required');
    const signInButton = card?.buttons?.find((button) => button.type === 'openUrl');
    expect(signInButton).toBeDefined();
    expect(signInButton?.value).toContain('https://example.test/api/teams/auth/callback/bot?');
    expect(signInButton?.value).toContain('tenantId=tenant-1');
    expect(signInButton?.value).toContain('conversationId=conversation-1');
    expect(signInButton?.value).toContain('microsoftTenantId=entra-tenant-1');
    // The adaptive rendering carries the same sign-in action.
    const adaptiveActions = (response.adaptiveAttachments?.[0]?.content.actions ?? []) as Array<{ type: string; url?: string }>;
    expect(adaptiveActions.some((action) => action.type === 'Action.OpenUrl' && action.url?.includes('tenantId=tenant-1'))).toBe(true);
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T059: "ticket 1234" and "ticket #1234" resolve by ticket number through open_record', async () => {
    executeTeamsActionMock.mockResolvedValue(
      buildActionSuccess('open_record', {
        summary: { title: 'Ticket 1234', text: 'Printer offline • Open' },
      })
    );

    await handleTeamsBotActivity(buildPersonalMessageActivity('ticket 1234'), { tenantIdHint: 'tenant-1' });
    await handleTeamsBotActivity(buildPersonalMessageActivity('ticket #1234'), { tenantIdHint: 'tenant-1' });

    expect(executeTeamsActionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actionId: 'open_record',
        target: { entityType: 'ticket', ticketId: '1234' },
      })
    );
    expect(executeTeamsActionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actionId: 'open_record',
        target: { entityType: 'ticket', ticketId: '1234' },
      })
    );
  });

  it('T061: "ticket printer" returns a numbered pick list gated by ticket:read RBAC and saves ordinal context', async () => {
    searchTeamsTicketsMock.mockResolvedValue([
      {
        ticket_id: 'ticket-uuid-1',
        ticket_number: 'ALGA-101',
        title: 'Printer offline',
        status_name: 'Open',
        priority_name: 'High',
        client_name: 'Acme',
      },
      {
        ticket_id: 'ticket-uuid-2',
        ticket_number: 'ALGA-102',
        title: 'Printer jam',
        status_name: 'Open',
        priority_name: 'Low',
        client_name: 'Acme',
      },
    ]);

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('ticket printer'), {
      tenantIdHint: 'tenant-1',
    });

    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'ticket',
      'read',
      expect.anything()
    );
    expect(searchTeamsTicketsMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', query: 'printer' })
    );
    expect(response.attachments?.[1]?.content.title).toBe('1. ALGA-101');
    expect(response.attachments?.[2]?.content.title).toBe('2. ALGA-102');
    // The footer documents the ordinal-vs-ticket-number collision rule.
    expect(response.text).toContain('Reply “ticket 2” to open the second result');
    expect(saveTeamsConversationContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        conversationId: 'conversation-1',
        items: [
          { entityType: 'ticket', id: 'ticket-uuid-1', displayId: 'ALGA-101' },
          { entityType: 'ticket', id: 'ticket-uuid-2', displayId: 'ALGA-102' },
        ],
      })
    );
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T061: ticket title search is denied without ticket:read', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('ticket printer'), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.text).toContain('do not have permission to search tickets');
    expect(searchTeamsTicketsMock).not.toHaveBeenCalled();
  });

  it('T062: ticket title search with no matches returns a friendly empty state with suggestions', async () => {
    searchTeamsTicketsMock.mockResolvedValue([]);

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('ticket unfindable widget'), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.text).toContain('No open tickets matched “unfindable widget”');
    expect(response.attachments?.[0]?.content.title).toBe('No tickets found');
    expect(response.attachments?.[0]?.content.text).toContain('my tickets');
    expect(response.suggestedActions?.actions.map((action) => action.value)).toContain('my tickets');
  });

  it('T063: "approve 2" after "my approvals" resolves ordinal 2 from stored context and executes approval_response', async () => {
    executeTeamsActionMock.mockResolvedValueOnce(
      buildActionSuccess('my_approvals', {
        summary: { title: 'My approvals', text: 'Found 2 approval items ready for review in Teams.' },
        items: [
          { id: 'approval-uuid-1', title: 'Approval approval-uuid-1', summary: 'Taylor', entityType: 'approval', links: [] },
          { id: 'approval-uuid-2', title: 'Approval approval-uuid-2', summary: 'Jamie', entityType: 'approval', links: [] },
        ],
      })
    );

    await handleTeamsBotActivity(buildPersonalMessageActivity('my approvals'), { tenantIdHint: 'tenant-1' });

    expect(saveTeamsConversationContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        conversationId: 'conversation-1',
        items: [
          { entityType: 'approval', id: 'approval-uuid-1' },
          { entityType: 'approval', id: 'approval-uuid-2' },
        ],
      })
    );

    getTeamsConversationContextMock.mockResolvedValue({
      items: [
        { entityType: 'approval', id: 'approval-uuid-1' },
        { entityType: 'approval', id: 'approval-uuid-2' },
      ],
      listedAt: new Date().toISOString(),
    });
    executeTeamsActionMock.mockResolvedValueOnce(
      buildActionSuccess('approval_response', {
        operation: 'mutation',
        summary: { title: 'Approval completed', text: 'Approval approval-uuid-2 was approved successfully.' },
      })
    );

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('approve 2'), {
      tenantIdHint: 'tenant-1',
    });

    expect(executeTeamsActionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actionId: 'approval_response',
        target: { entityType: 'approval', approvalId: 'approval-uuid-2' },
        input: expect.objectContaining({ approvalId: 'approval-uuid-2', outcome: 'approve' }),
      })
    );
    expect(response.text).toContain('approved successfully');
  });

  it('T063: "ticket 2" resolves the second stored ticket when an unexpired ticket context exists', async () => {
    getTeamsConversationContextMock.mockResolvedValue({
      items: [
        { entityType: 'ticket', id: 'ticket-uuid-1', displayId: 'ALGA-101' },
        { entityType: 'ticket', id: 'ticket-uuid-2', displayId: 'ALGA-102' },
      ],
      listedAt: new Date().toISOString(),
    });
    executeTeamsActionMock.mockResolvedValue(buildActionSuccess('open_record'));

    await handleTeamsBotActivity(buildPersonalMessageActivity('ticket 2'), { tenantIdHint: 'tenant-1' });

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'open_record',
        target: { entityType: 'ticket', ticketId: 'ticket-uuid-2' },
      })
    );
  });

  it('T064: expired or out-of-range ordinal references return guidance, not an error', async () => {
    // Expired/missing context: "approve 2" cannot be a real approval id.
    getTeamsConversationContextMock.mockResolvedValue(null);
    const expired = await handleTeamsBotActivity(buildPersonalMessageActivity('approve 2'), {
      tenantIdHint: 'tenant-1',
    });
    expect(expired.text).toContain('expire after 30 minutes');
    expect(expired.attachments?.[0]?.content.title).toBe('List reference expired');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();

    // Out-of-range ordinal against a fresh list.
    getTeamsConversationContextMock.mockResolvedValue({
      items: [{ entityType: 'approval', id: 'approval-uuid-1' }],
      listedAt: new Date().toISOString(),
    });
    const outOfRange = await handleTeamsBotActivity(buildPersonalMessageActivity('approve 5'), {
      tenantIdHint: 'tenant-1',
    });
    expect(outOfRange.text).toContain('out of range');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T063/T035: "assign 2 to me" resolves the ordinal ticket and executes assign_ticket', async () => {
    getTeamsConversationContextMock.mockResolvedValue({
      items: [
        { entityType: 'ticket', id: 'ticket-uuid-1', displayId: 'ALGA-101' },
        { entityType: 'ticket', id: 'ticket-uuid-2', displayId: 'ALGA-102' },
      ],
      listedAt: new Date().toISOString(),
    });
    executeTeamsActionMock.mockResolvedValue(
      buildActionSuccess('assign_ticket', {
        operation: 'mutation',
        summary: { title: 'Ticket assigned', text: 'Ticket ALGA-102 was reassigned successfully.' },
      })
    );

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('assign 2 to me'), {
      tenantIdHint: 'tenant-1',
    });

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'assign_ticket',
        target: { entityType: 'ticket', ticketId: 'ticket-uuid-2' },
        input: expect.objectContaining({ ticketId: 'ticket-uuid-2', assigneeId: 'user-1' }),
      })
    );
    expect(response.text).toContain('assigned to');
  });

  it('T066: "assign ticket" with no args prompts with a concrete example instead of the unsupported fallback', async () => {
    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('assign ticket'), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.text).toContain('Specify a ticket reference');
    expect(response.text).toContain('assign ticket <ticket-id> to me');
    expect(response.text).not.toContain('not supported');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T067: "log time" without duration prompts for the duration format and completes on follow-up', async () => {
    const prompt = await handleTeamsBotActivity(buildPersonalMessageActivity('log time ticket ticket-2002'), {
      tenantIdHint: 'tenant-1',
    });

    expect(prompt.attachments?.[0]?.content.title).toBe('Duration required');
    expect(prompt.attachments?.[0]?.content.text).toContain('1h 30m');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();

    executeTeamsActionMock.mockResolvedValue(
      buildActionSuccess('log_time', {
        operation: 'mutation',
        summary: { title: 'Time logged', text: 'Logged 30 minutes from Teams.' },
      })
    );
    const completed = await handleTeamsBotActivity(
      buildPersonalMessageActivity('log time ticket ticket-2002 30m: Investigated'),
      { tenantIdHint: 'tenant-1' }
    );

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'log_time',
        input: expect.objectContaining({ durationMinutes: 30 }),
      })
    );
    expect(completed.text).toContain('Logged 30 minutes');
  });

  it('T068: "assing ticket 12" yields a did-you-mean suggestion for assign ticket', async () => {
    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('assing ticket 12'), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.text).toContain('Did you mean');
    expect(response.text).toContain('assign ticket <number> to me');
    expect(response.attachments?.[0]?.content.title).toBe('Teams bot commands');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T069: "new ticket <title> for <client>" creates a ticket via create_ticket_from_message and returns the ticket card', async () => {
    searchTeamsClientsByNameMock.mockResolvedValue([{ client_id: 'client-1', client_name: 'Acme' }]);
    executeTeamsActionMock.mockResolvedValue(
      buildActionSuccess('create_ticket_from_message', {
        operation: 'mutation',
        summary: { title: 'Created ticket ALGA-200', text: 'Created ticket ALGA-200 from the selected Teams message.' },
        links: [{ type: 'psa', label: 'Open in full PSA', url: 'https://example.test/msp/tickets/ticket-200' }],
      })
    );

    const response = await handleTeamsBotActivity(
      buildPersonalMessageActivity('new ticket Printer offline for Acme'),
      { tenantIdHint: 'tenant-1' }
    );

    expect(searchTeamsClientsByNameMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', name: 'Acme' })
    );
    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'create_ticket_from_message',
        idempotencyKey: expect.any(String),
        input: expect.objectContaining({
          title: 'Printer offline',
          description: 'Printer offline',
          boardId: 'board-1',
          statusId: 'status-1',
          clientId: 'client-1',
        }),
      })
    );
    expect(response.attachments?.[0]?.content.title).toBe('Created ticket ALGA-200');
  });

  it('T069: "new ticket" guidance covers missing title, unknown client, and ambiguous client', async () => {
    const missingTitle = await handleTeamsBotActivity(buildPersonalMessageActivity('new ticket'), {
      tenantIdHint: 'tenant-1',
    });
    expect(missingTitle.text).toContain('Add a ticket title');

    searchTeamsClientsByNameMock.mockResolvedValue([]);
    const unknownClient = await handleTeamsBotActivity(
      buildPersonalMessageActivity('new ticket Printer offline for Nowhere Inc'),
      { tenantIdHint: 'tenant-1' }
    );
    expect(unknownClient.text).toContain('No active client matched “Nowhere Inc”');

    searchTeamsClientsByNameMock.mockResolvedValue([
      { client_id: 'client-1', client_name: 'Acme East' },
      { client_id: 'client-2', client_name: 'Acme West' },
    ]);
    const ambiguousClient = await handleTeamsBotActivity(
      buildPersonalMessageActivity('new ticket Printer offline for Acme'),
      { tenantIdHint: 'tenant-1' }
    );
    expect(ambiguousClient.text).toContain('More than one client matched');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T070: "new ticket" without ticket:create renders the standard permission-denied result', async () => {
    listTeamsActiveClientsMock.mockResolvedValue([{ client_id: 'client-1', client_name: 'Acme' }]);
    executeTeamsActionMock.mockResolvedValue({
      success: false,
      actionId: 'create_ticket_from_message',
      surface: 'bot',
      operation: 'mutation',
      error: {
        code: 'forbidden',
        message: 'You do not have permission to create PSA tickets from Teams messages.',
        remediation: 'Use the full PSA application if you need access to this operation.',
      },
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: 'key-1',
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: [],
      },
    });

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('new ticket Printer offline'), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.text).toContain('do not have permission to create PSA tickets');
    expect(response.attachments?.[0]?.content.title).toBe('Teams bot request unavailable');
  });

  it('T071: replies carry Adaptive Card primaries and retry with the hero fallback when the client rejects adaptive content', async () => {
    isBotConnectorConfiguredMock.mockReturnValue(true);
    executeTeamsActionMock.mockResolvedValue(
      buildActionSuccess('my_tickets', {
        summary: { title: 'My tickets', text: 'Found 1 assigned ticket for the signed-in technician.' },
        items: [
          {
            id: 'ticket-uuid-1',
            displayId: 'ALGA-101',
            title: 'ALGA-101',
            summary: 'Printer offline • Open',
            entityType: 'ticket',
            links: [{ type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket-1' }],
          },
        ],
      })
    );
    sendBotActivityMock
      .mockRejectedValueOnce(new Error('Failed to send Bot Framework activity (415 Unsupported Media Type): adaptive rejected'))
      .mockResolvedValueOnce({ status: 'sent' });

    const request = new Request('https://example.test/api/teams/bot/messages?tenantId=tenant-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...buildPersonalMessageActivity('my tickets'),
        id: 'activity-1',
        serviceUrl: 'https://smba.trafficmanager.net/amer/',
      }),
    });

    const response = await handleTeamsBotActivityRequest(request);
    expect(response.status).toBe(200);
    expect(sendBotActivityMock).toHaveBeenCalledTimes(2);

    const primaryActivity = sendBotActivityMock.mock.calls[0][0].activity;
    expect(primaryActivity.attachments?.[0]?.contentType).toBe('application/vnd.microsoft.card.adaptive');
    // Ticket adaptive cards carry inline registry-backed actions.
    const ticketCardActions = primaryActivity.attachments?.[1]?.content?.actions ?? [];
    expect(ticketCardActions).toContainEqual(
      expect.objectContaining({
        type: 'Action.Submit',
        title: 'Assign to me',
        data: expect.objectContaining({
          command: 'bot_card_action',
          actionId: 'assign_ticket',
          ticketId: 'ALGA-101',
          idempotencyKey: expect.any(String),
        }),
      })
    );

    const fallbackActivity = sendBotActivityMock.mock.calls[1][0].activity;
    expect(fallbackActivity.attachments?.[0]?.contentType).toBe('application/vnd.microsoft.card.hero');
  });

  it('T072: the "Assign to me" card action executes assign_ticket and updates the card in place', async () => {
    isBotConnectorConfiguredMock.mockReturnValue(true);
    executeTeamsActionMock.mockResolvedValue(
      buildActionSuccess('assign_ticket', {
        operation: 'mutation',
        summary: { title: 'Ticket assigned', text: 'Ticket ALGA-101 was reassigned successfully.' },
      })
    );

    const request = new Request('https://example.test/api/teams/bot/messages?tenantId=tenant-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...buildPersonalMessageActivity(''),
        id: 'submit-activity-1',
        replyToId: 'card-activity-1',
        serviceUrl: 'https://smba.trafficmanager.net/amer/',
        value: {
          command: 'bot_card_action',
          actionId: 'assign_ticket',
          ticketId: 'ALGA-101',
          idempotencyKey: 'card-idem-1',
        },
      }),
    });

    const response = await handleTeamsBotActivityRequest(request);
    expect(response.status).toBe(200);

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'assign_ticket',
        idempotencyKey: 'card-idem-1',
        target: { entityType: 'ticket', ticketId: 'ALGA-101' },
        input: expect.objectContaining({ ticketId: 'ALGA-101', assigneeId: 'user-1' }),
      })
    );
    expect(updateBotActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        activityId: 'card-activity-1',
      })
    );
    const updatedActivity = updateBotActivityMock.mock.calls[0][0].activity;
    expect(updatedActivity.attachments?.[0]?.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(updatedActivity.text).toContain('was assigned to Alex Tech');
    expect(sendBotActivityMock).not.toHaveBeenCalled();
  });

  it('T072: a failed in-place card update falls back to a normal reply', async () => {
    isBotConnectorConfiguredMock.mockReturnValue(true);
    executeTeamsActionMock.mockResolvedValue(
      buildActionSuccess('assign_ticket', {
        operation: 'mutation',
        summary: { title: 'Ticket assigned', text: 'Ticket ALGA-101 was reassigned successfully.' },
      })
    );
    updateBotActivityMock.mockRejectedValueOnce(
      new Error('Failed to update Bot Framework activity (403 Forbidden): nope')
    );

    const request = new Request('https://example.test/api/teams/bot/messages?tenantId=tenant-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...buildPersonalMessageActivity(''),
        id: 'submit-activity-1',
        replyToId: 'card-activity-1',
        serviceUrl: 'https://smba.trafficmanager.net/amer/',
        value: {
          command: 'bot_card_action',
          actionId: 'assign_ticket',
          ticketId: 'ALGA-101',
          idempotencyKey: 'card-idem-2',
        },
      }),
    });

    await handleTeamsBotActivityRequest(request);
    expect(updateBotActivityMock).toHaveBeenCalledTimes(1);
    expect(sendBotActivityMock).toHaveBeenCalledTimes(1);
  });

  it('T073: card actions denied by allowed_actions/RBAC render the registry failure and never update the card', async () => {
    isBotConnectorConfiguredMock.mockReturnValue(true);
    executeTeamsActionMock.mockResolvedValue({
      success: false,
      actionId: 'assign_ticket',
      surface: 'bot',
      operation: 'mutation',
      error: {
        code: 'capability_disabled',
        message: 'This Teams quick action is disabled for the tenant.',
        remediation: 'Review the tenant Teams settings or use the full PSA application instead.',
      },
      warnings: [],
      metadata: {
        surface: 'bot',
        idempotencyKey: 'card-idem-3',
        idempotentReplay: false,
        invokingSurface: 'bot',
        businessOperations: [],
      },
    });

    const request = new Request('https://example.test/api/teams/bot/messages?tenantId=tenant-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...buildPersonalMessageActivity(''),
        id: 'submit-activity-2',
        replyToId: 'card-activity-2',
        serviceUrl: 'https://smba.trafficmanager.net/amer/',
        value: {
          command: 'bot_card_action',
          actionId: 'assign_ticket',
          ticketId: 'ALGA-101',
          idempotencyKey: 'card-idem-3',
        },
      }),
    });

    await handleTeamsBotActivityRequest(request);

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'assign_ticket' })
    );
    expect(updateBotActivityMock).not.toHaveBeenCalled();
    expect(sendBotActivityMock).toHaveBeenCalledTimes(1);
    const replyActivity = sendBotActivityMock.mock.calls[0][0].activity;
    expect(replyActivity.text).toContain('disabled for the tenant');
  });

  it('T073: the "Add note" card action replies with an instructions prompt without executing a mutation', async () => {
    const response = await handleTeamsBotActivity(
      {
        ...buildPersonalMessageActivity(''),
        replyToId: 'card-activity-3',
        value: {
          command: 'bot_card_action',
          actionId: 'add_note',
          ticketId: 'ALGA-101',
        },
      },
      { tenantIdHint: 'tenant-1' }
    );

    expect(response.text).toContain('add note ALGA-101:');
    expect(response.replaceActivityId).toBeUndefined();
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T074: every shared command definition parses to a real handler command (no unsupported fallbacks)', async () => {
    const { TEAMS_BOT_COMMAND_DEFINITIONS } = await import(
      '@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotCommands'
    );
    executeTeamsActionMock.mockResolvedValue(buildActionSuccess('open_record'));
    searchTeamsClientsByNameMock.mockResolvedValue([{ client_id: 'client-1', client_name: 'Acme' }]);
    listTeamsActiveClientsMock.mockResolvedValue([{ client_id: 'client-1', client_name: 'Acme' }]);

    const substitutions: Record<string, string> = {
      '<number>': '1234',
      '<title>': 'Printer offline',
      '<note>': 'note text',
      '<reply>': 'reply text',
      '<n>': '2',
      '<comment>': 'needs detail',
      '<client>': 'Acme',
    };

    for (const definition of TEAMS_BOT_COMMAND_DEFINITIONS) {
      let commandText = definition.example;
      for (const [placeholder, value] of Object.entries(substitutions)) {
        commandText = commandText.split(placeholder).join(value);
      }

      const response = await handleTeamsBotActivity(buildPersonalMessageActivity(commandText), {
        tenantIdHint: 'tenant-1',
      });

      expect(response.text, `command "${commandText}" (from "${definition.id}") must be recognized`).not.toContain(
        'is not supported'
      );
    }
  });

  it('T075: channel-scope messages get the friendly unsupported-scope reply with a docs link', async () => {
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

    expect(response.attachments?.[0]?.content.title).toBe('Unsupported conversation type');
    expect(response.attachments?.[0]?.content.buttons).toContainEqual(
      expect.objectContaining({
        type: 'openUrl',
        value: 'https://docs.algapsa.com/integrations/teams-setup#supported-scopes',
      })
    );
  });

  it('T080: the help card lists only commands the user\'s RBAC allows, read-only commands always shown', async () => {
    listAvailableTeamsActionsMock.mockResolvedValue(
      buildFullAvailability({ my_approvals: false, approval_response: false })
    );

    const response = await handleTeamsBotActivity(buildPersonalMessageActivity('help'), {
      tenantIdHint: 'tenant-1',
    });

    const helpText = response.attachments?.[0]?.content.text ?? '';
    expect(helpText).toContain('my tickets');
    expect(helpText).toContain('ticket <number>');
    expect(helpText).toContain('assign ticket <number> to me');
    expect(helpText).not.toContain('my approvals');
    expect(helpText).not.toContain('approve approval');
    expect(helpText).not.toContain('request changes approval');
  });
});
