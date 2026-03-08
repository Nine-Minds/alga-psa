import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';
import { TicketService } from 'server/src/lib/api/services/TicketService';
import { ContactService } from 'server/src/lib/api/services/ContactService';
import {
  handleTeamsMessageExtensionActivity,
  type TeamsMessageExtensionActivity,
} from 'server/src/lib/teams/messageExtension/teamsMessageExtensionHandler';

const {
  resolveTeamsTenantContextMock,
  resolveTeamsLinkedUserMock,
  getUserWithRolesMock,
  createTenantKnexMock,
  hasPermissionMock,
  executeTeamsActionMock,
  listPendingApprovalsForTeamsMock,
} = vi.hoisted(() => ({
  resolveTeamsTenantContextMock: vi.fn(),
  resolveTeamsLinkedUserMock: vi.fn(),
  getUserWithRolesMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  executeTeamsActionMock: vi.fn(),
  listPendingApprovalsForTeamsMock: vi.fn(),
}));

vi.mock('server/src/lib/teams/resolveTeamsTenantContext', () => ({
  resolveTeamsTenantContext: resolveTeamsTenantContextMock,
}));

vi.mock('server/src/lib/teams/resolveTeamsLinkedUser', () => ({
  resolveTeamsLinkedUser: resolveTeamsLinkedUserMock,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: createTenantKnexMock,
    getUserWithRoles: getUserWithRolesMock,
  };
});

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/teams/actions/teamsActionRegistry', () => ({
  executeTeamsAction: executeTeamsActionMock,
}));

vi.mock('server/src/lib/teams/approvals/queryPendingApprovalsForTeams', () => ({
  listPendingApprovalsForTeams: listPendingApprovalsForTeamsMock,
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

function buildActivity(overrides: Partial<TeamsMessageExtensionActivity> = {}): TeamsMessageExtensionActivity {
  return {
    type: 'invoke',
    name: 'composeExtension/query',
    from: {
      aadObjectId: 'aad-user-1',
    },
    channelData: {
      tenant: {
        id: 'entra-tenant-1',
      },
    },
    value: {
      commandId: 'searchRecords',
      commandContext: 'compose',
      parameters: [
        {
          name: 'query',
          value: 'vpn',
        },
      ],
    },
    ...overrides,
  };
}

describe('teamsMessageExtensionHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    resolveTeamsTenantContextMock.mockResolvedValue({
      status: 'resolved',
      tenantId: 'tenant-1',
      installStatus: 'active',
      enabledCapabilities: ['message_extension', 'personal_tab'],
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
    listPendingApprovalsForTeamsMock.mockResolvedValue([
      {
        id: 'approval-1',
        approval_status: 'SUBMITTED',
        first_name: 'Jamie',
        last_name: 'Rivera',
        period_start_date: '2026-03-02',
        period_end_date: '2026-03-08',
      },
    ]);
    createTenantKnexMock.mockResolvedValue({
      knex: vi.fn(() => ({
        join: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            task_id: 'task-1',
            project_id: 'project-1',
          },
        ]),
      })),
    });
    executeTeamsActionMock.mockImplementation(async ({ target }: { target: { entityType: string; ticketId?: string; taskId?: string; contactId?: string; approvalId?: string } }) => ({
      success: true,
      actionId: 'open_record',
      surface: 'message_extension',
      operation: 'lookup',
      summary: {
        title:
          target.entityType === 'ticket'
            ? 'Ticket T-1001'
            : target.entityType === 'project_task'
              ? 'Project task VPN cleanup'
              : target.entityType === 'contact'
                ? 'Contact Taylor Nguyen'
                : 'Approval approval-1',
        text:
          target.entityType === 'ticket'
            ? 'VPN outage • In progress'
            : target.entityType === 'project_task'
              ? 'VPN cleanup for onboarding'
              : target.entityType === 'contact'
                ? 'Taylor Nguyen • Contoso'
                : 'Jamie Rivera • 2026-03-02 to 2026-03-08 • SUBMITTED',
      },
      links: [
        { type: 'teams_tab', label: 'Open in Teams tab', url: `https://teams.test/${target.entityType}` },
        { type: 'psa', label: 'Open in full PSA', url: `/msp/${target.entityType}` },
      ],
      items: [
        {
          id: target.ticketId || target.taskId || target.contactId || target.approvalId || 'record-1',
          title:
            target.entityType === 'ticket'
              ? 'Ticket T-1001'
              : target.entityType === 'project_task'
                ? 'Project task VPN cleanup'
                : target.entityType === 'contact'
                  ? 'Contact Taylor Nguyen'
                  : 'Approval approval-1',
          summary:
            target.entityType === 'ticket'
              ? 'VPN outage • In progress'
              : target.entityType === 'project_task'
                ? 'VPN cleanup for onboarding'
                : target.entityType === 'contact'
                  ? 'Taylor Nguyen • Contoso'
                  : 'Jamie Rivera • 2026-03-02 to 2026-03-08 • SUBMITTED',
          entityType: target.entityType,
          links: [
            { type: 'teams_tab', label: 'Open in Teams tab', url: `https://teams.test/${target.entityType}` },
            { type: 'psa', label: 'Open in full PSA', url: `/msp/${target.entityType}` },
          ],
        },
      ],
      warnings: [],
      metadata: {
        surface: 'message_extension',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'message_extension',
        businessOperations: ['TicketService.getById'],
      },
    }));

    vi.spyOn(TicketService.prototype, 'search').mockResolvedValue([
      { ticket_id: 'ticket-1' } as any,
    ]);
    vi.spyOn(ContactService.prototype, 'search').mockResolvedValue([
      { contact_name_id: 'contact-1', client_id: 'client-1' } as any,
    ]);
  });

  it('T311/T313/T315/T317: search returns ticket, task, contact, and approval matches for the Teams query command', async () => {
    const response = await handleTeamsMessageExtensionActivity(buildActivity(), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.composeExtension.type).toBe('result');
    expect(response.composeExtension.attachments).toHaveLength(4);
    expect(response.composeExtension.attachments?.map((attachment) => attachment.content.title)).toEqual([
      'Ticket T-1001',
      'Project task VPN cleanup',
      'Contact Taylor Nguyen',
      'Approval approval-1',
    ]);
    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'open_record',
        surface: 'message_extension',
        target: {
          entityType: 'ticket',
          ticketId: 'ticket-1',
        },
      })
    );
  });

  it('T312/T314/T316/T318/T325/T326: search suppresses entity types the user cannot read and returns a recoverable empty-state message', async () => {
    hasPermissionMock.mockImplementation(async (_user: IUserWithRoles, resource: string) => resource === 'ticket');
    vi.spyOn(TicketService.prototype, 'search').mockResolvedValue([]);
    vi.spyOn(ContactService.prototype, 'search').mockResolvedValue([]);
    listPendingApprovalsForTeamsMock.mockResolvedValue([]);
    createTenantKnexMock.mockResolvedValue({
      knex: vi.fn(() => ({
        join: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      })),
    });

    const response = await handleTeamsMessageExtensionActivity(buildActivity(), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.composeExtension.type).toBe('message');
    expect(response.composeExtension.text).toContain('No PSA records matched');
    expect(executeTeamsActionMock).not.toHaveBeenCalled();
  });

  it('T319/T320/T335/T336: search works from compose and command-box contexts and rejects unsupported contexts with recoverable guidance', async () => {
    const composeResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        value: {
          commandId: 'searchRecords',
          commandContext: 'compose',
          parameters: [{ name: 'query', value: 'vpn' }],
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );
    const commandBoxResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        value: {
          commandId: 'searchRecords',
          commandContext: 'commandBox',
          parameters: [{ name: 'query', value: 'vpn' }],
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );
    const invalidContextResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        value: {
          commandId: 'searchRecords',
          commandContext: 'message',
          parameters: [{ name: 'query', value: 'vpn' }],
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(composeResponse.composeExtension.type).toBe('result');
    expect(commandBoxResponse.composeExtension.type).toBe('result');
    expect(invalidContextResponse.composeExtension.type).toBe('message');
    expect(invalidContextResponse.composeExtension.text).toContain('compose and command box contexts only');
  });

  it('T321/T322/T341/T342: action commands resolve Teams-authenticated context from message scope and return a task-module response for supported commands', async () => {
    const response = await handleTeamsMessageExtensionActivity(
      buildActivity({
        name: 'composeExtension/fetchTask',
        value: {
          commandId: 'createTicketFromMessage',
          commandContext: 'message',
          messagePayload: {
            id: 'message-1',
            subject: 'VPN outage from Teams',
            body: {
              content: '<div>The VPN has been down since 9 AM.</div>',
            },
            from: {
              user: {
                displayName: 'Morgan Message',
              },
            },
            linkToMessage: 'https://teams.example.test/messages/1',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(resolveTeamsLinkedUserMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      microsoftAccountId: 'aad-user-1',
    });
    expect(getUserWithRolesMock).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(response).toMatchObject({
      task: {
        type: 'continue',
        value: {
          title: 'Create ticket from Teams message',
          width: 'medium',
          height: 'medium',
        },
      },
    });
    expect((response as any).task.value.card.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Create ticket from Teams message' }),
        expect.objectContaining({ text: 'From: Morgan Message' }),
        expect.objectContaining({ text: 'Subject: VPN outage from Teams' }),
      ])
    );
  });

  it('T322/T342: action commands reject unsupported contexts or missing message payloads with recoverable task messages', async () => {
    const wrongContextResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        name: 'composeExtension/fetchTask',
        value: {
          commandId: 'createTicketFromMessage',
          commandContext: 'compose',
          messagePayload: {
            subject: 'VPN outage from Teams',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    const missingPayloadResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        name: 'composeExtension/fetchTask',
        value: {
          commandId: 'updateFromMessage',
          commandContext: 'message',
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(wrongContextResponse).toEqual({
      task: {
        type: 'message',
        value: 'This Teams message action is available from message context only.',
      },
    });
    expect(missingPayloadResponse).toEqual({
      task: {
        type: 'message',
        value: 'Select a Teams message with usable content before starting this PSA workflow.',
      },
    });
  });

  it('T323/T324/T337/T338: search remains tenant-scoped and returns clear remediation when the Teams integration is unavailable', async () => {
    await handleTeamsMessageExtensionActivity(buildActivity(), {
      tenantIdHint: 'tenant-1',
    });

    expect(resolveTeamsTenantContextMock).toHaveBeenCalledWith({
      explicitTenantId: 'tenant-1',
      microsoftTenantId: 'entra-tenant-1',
      requiredCapability: 'message_extension',
    });
    expect(TicketService.prototype.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-1',
        userId: 'user-1',
      })
    );
    expect(createTenantKnexMock).toHaveBeenCalledWith('tenant-1');

    resolveTeamsTenantContextMock.mockResolvedValueOnce({
      status: 'not_ready',
      message: 'Teams message extension is not active for this tenant.',
    });

    const unavailableResponse = await handleTeamsMessageExtensionActivity(buildActivity(), {
      tenantIdHint: 'tenant-1',
    });

    expect(unavailableResponse).toEqual({
      composeExtension: {
        type: 'message',
        text: 'Teams message extension is not active for this tenant.',
      },
      cacheInfo: {
        cacheType: 'no-cache',
      },
    });
  });

  it('T329/T330/T331/T332/T343/T345/T347/T351/T352: search results reuse shared action summaries and deep links for compact Teams cards', async () => {
    const response = await handleTeamsMessageExtensionActivity(buildActivity(), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.composeExtension.type).toBe('result');
    expect(response.composeExtension.attachments?.[0]).toEqual(
      expect.objectContaining({
        contentType: 'application/vnd.microsoft.card.hero',
        content: expect.objectContaining({
          title: 'Ticket T-1001',
          text: 'VPN outage • In progress',
          buttons: [
            { type: 'openUrl', title: 'Open in Teams tab', value: 'https://teams.test/ticket' },
            { type: 'openUrl', title: 'Open in full PSA', value: '/msp/ticket' },
          ],
        }),
      })
    );
    expect(response.composeExtension.attachments?.[1]?.content.title).toBe('Project task VPN cleanup');
    expect(response.composeExtension.attachments?.[2]?.content.title).toBe('Contact Taylor Nguyen');
    expect(response.composeExtension.attachments?.[3]?.content.title).toBe('Approval approval-1');
    expect(executeTeamsActionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actionId: 'open_record',
        surface: 'message_extension',
      })
    );
  });

  it('T344/T346/T348: search result links only include entities returned by the shared open-record action mapping', async () => {
    executeTeamsActionMock.mockResolvedValueOnce({
      success: false,
      actionId: 'open_record',
      surface: 'message_extension',
      operation: 'lookup',
      error: {
        code: 'forbidden',
        message: 'Permission denied',
      },
      warnings: [],
      metadata: {
        surface: 'message_extension',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'message_extension',
        businessOperations: ['TicketService.getById'],
      },
    });

    const response = await handleTeamsMessageExtensionActivity(buildActivity(), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.composeExtension.type).toBe('result');
    expect(response.composeExtension.attachments).toHaveLength(3);
    expect(response.composeExtension.attachments?.map((attachment) => attachment.content.title)).not.toContain(
      'Ticket T-1001'
    );
  });

  it('T350: action/query command support stays focused on PSA lookup and message-driven commands instead of accepting arbitrary message-extension commands', async () => {
    const unsupportedCommand = await handleTeamsMessageExtensionActivity(
      buildActivity({
        value: {
          commandId: 'freeFormChat',
          commandContext: 'compose',
          parameters: [{ name: 'query', value: 'vpn' }],
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(unsupportedCommand).toEqual({
      composeExtension: {
        type: 'message',
        text: 'This Teams message extension command is not supported yet.',
      },
      cacheInfo: {
        cacheType: 'no-cache',
      },
    });
  });
});
