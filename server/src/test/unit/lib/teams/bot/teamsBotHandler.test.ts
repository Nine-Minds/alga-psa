import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  handleTeamsBotActivity,
  handleTeamsBotActivityRequest,
  type TeamsBotActivity,
} from 'server/src/lib/teams/bot/teamsBotHandler';

const {
  resolveTeamsTenantContextMock,
  resolveTeamsLinkedUserMock,
  getUserWithRolesMock,
  getTeamsIntegrationExecutionStateMock,
  executeTeamsActionMock,
  listAvailableTeamsActionsMock,
} = vi.hoisted(() => ({
  resolveTeamsTenantContextMock: vi.fn(),
  resolveTeamsLinkedUserMock: vi.fn(),
  getUserWithRolesMock: vi.fn(),
  getTeamsIntegrationExecutionStateMock: vi.fn(),
  executeTeamsActionMock: vi.fn(),
  listAvailableTeamsActionsMock: vi.fn(),
}));

vi.mock('server/src/lib/teams/resolveTeamsTenantContext', () => ({
  resolveTeamsTenantContext: resolveTeamsTenantContextMock,
}));

vi.mock('server/src/lib/teams/resolveTeamsLinkedUser', () => ({
  resolveTeamsLinkedUser: resolveTeamsLinkedUserMock,
}));

vi.mock('@alga-psa/db', () => ({
  getUserWithRoles: getUserWithRolesMock,
}));

vi.mock('@alga-psa/integrations/actions/integrations/teamsActions', () => ({
  getTeamsIntegrationExecutionState: getTeamsIntegrationExecutionStateMock,
}));

vi.mock('server/src/lib/teams/actions/teamsActionRegistry', () => ({
  executeTeamsAction: executeTeamsActionMock,
  listAvailableTeamsActions: listAvailableTeamsActionsMock,
}));

function buildUser(overrides: Partial<IUserWithRoles> = {}): IUserWithRoles {
  return {
    user_id: 'user-1',
    tenant: 'tenant-1',
    user_type: 'internal',
    first_name: 'Alex',
    last_name: 'Tech',
    email: 'alex@example.test',
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
    getTeamsIntegrationExecutionStateMock.mockResolvedValue({
      selectedProfileId: 'profile-1',
      installStatus: 'active',
      enabledCapabilities: ['personal_bot', 'personal_tab', 'message_extension'],
      allowedActions: ['assign_ticket', 'add_note'],
      appId: 'teams-app-1',
      packageMetadata: {
        baseUrl: 'https://example.test',
      },
    });
    listAvailableTeamsActionsMock.mockResolvedValue([]);
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
    expect(welcome.attachments?.[0]?.content.text).toContain('ticket <id>');
    expect(welcome.attachments?.[0]?.content.text).toContain('assign ticket <ticket-id>');
    expect(welcome.suggestedActions?.actions.map((action) => action.value)).toContain('my tickets');

    const help = await handleTeamsBotActivity(buildPersonalMessageActivity('help'), { tenantIdHint: 'tenant-1' });

    expect(help.attachments?.[0]?.content.text).toContain('add note <ticket-id>');
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

  it('T264/T266: command shortcuts that need an explicit ticket reference fail safely and reuse the same entity target resolution', async () => {
    listAvailableTeamsActionsMock.mockResolvedValue([
      {
        actionId: 'add_note',
        operation: 'mutation',
        available: true,
        targetEntityTypes: ['ticket'],
        requiredInputs: [],
        businessOperations: ['TicketService.addComment'],
      },
    ]);
    executeTeamsActionMock.mockResolvedValue({
      success: true,
      actionId: 'open_record',
      surface: 'bot',
      operation: 'lookup',
      summary: {
        title: 'Ticket T-2002',
        text: 'Printer jam • Waiting on client',
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
        businessOperations: ['TicketService.getById'],
      },
    });

    const handoff = await handleTeamsBotActivity(buildPersonalMessageActivity('add note ticket-2002'), {
      tenantIdHint: 'tenant-1',
    });

    expect(listAvailableTeamsActionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          entityType: 'ticket',
          ticketId: 'ticket-2002',
        },
      })
    );
    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'open_record',
        target: {
          entityType: 'ticket',
          ticketId: 'ticket-2002',
        },
      })
    );
    expect(handoff.text).toContain('Open the record in Teams');

    const missingTarget = await handleTeamsBotActivity(buildPersonalMessageActivity('add note'), {
      tenantIdHint: 'tenant-1',
    });

    expect(missingTarget.text).toContain('Specify a ticket reference');
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
