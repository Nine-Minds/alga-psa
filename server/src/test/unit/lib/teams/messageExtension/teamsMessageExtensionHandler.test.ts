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
  listAvailableTeamsActionsMock,
  listPendingApprovalsForTeamsMock,
  createTicketWithRetryMock,
} = vi.hoisted(() => ({
  resolveTeamsTenantContextMock: vi.fn(),
  resolveTeamsLinkedUserMock: vi.fn(),
  getUserWithRolesMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  executeTeamsActionMock: vi.fn(),
  listAvailableTeamsActionsMock: vi.fn(),
  listPendingApprovalsForTeamsMock: vi.fn(),
  createTicketWithRetryMock: vi.fn(),
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
  listAvailableTeamsActions: listAvailableTeamsActionsMock,
  listTeamsActionDefinitions: () => [
    { id: 'assign_ticket', title: 'Assign ticket', description: '', operation: 'mutation', targetEntityTypes: [] },
    { id: 'add_note', title: 'Add note', description: '', operation: 'mutation', targetEntityTypes: [] },
    { id: 'reply_to_contact', title: 'Reply to contact', description: '', operation: 'mutation', targetEntityTypes: [] },
    { id: 'log_time', title: 'Log time', description: '', operation: 'mutation', targetEntityTypes: [] },
    { id: 'approval_response', title: 'Approval response', description: '', operation: 'mutation', targetEntityTypes: [] },
  ],
}));

vi.mock('server/src/lib/teams/approvals/queryPendingApprovalsForTeams', () => ({
  listPendingApprovalsForTeams: listPendingApprovalsForTeamsMock,
}));

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: {
    createTicketWithRetry: createTicketWithRetryMock,
  },
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

function createMockQuery(rows: any[]) {
  const chain: any = {
    leftJoin: vi.fn().mockReturnThis(),
    join: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    whereILike: vi.fn().mockReturnThis(),
    whereRaw: vi.fn().mockReturnThis(),
    whereNull: vi.fn().mockReturnThis(),
    orWhere: vi.fn().mockReturnThis(),
    orWhereILike: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    orderByRaw: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(async (count?: number) => (typeof count === 'number' ? rows.slice(0, count) : rows)),
    first: vi.fn().mockImplementation(async () => rows[0] ?? null),
  };

  return chain;
}

function createTenantKnexFixture(overrides: Partial<Record<string, any[]>> = {}) {
  const tables: Record<string, any[]> = {
    'project_tasks as pt': [
      {
        task_id: 'task-1',
        project_id: 'project-1',
      },
    ],
    boards: [
      {
        board_id: 'board-1',
        board_name: 'Help Desk',
        default_priority_id: 'priority-1',
        is_default: true,
      },
    ],
    statuses: [
      {
        status_id: 'status-1',
        name: 'New',
        is_default: true,
      },
    ],
    clients: [
      {
        client_id: 'client-1',
        client_name: 'Contoso',
      },
    ],
    'contacts as c': [
      {
        contact_name_id: 'contact-1',
        full_name: 'Taylor Nguyen',
        client_id: 'client-1',
        client_name: 'Contoso',
      },
    ],
    contacts: [
      {
        contact_name_id: 'contact-1',
        client_id: 'client-1',
      },
    ],
    priorities: [
      {
        priority_id: 'priority-1',
      },
    ],
    tickets: [],
    ...overrides,
  };

  const knex: any = vi.fn((tableName: string) => createMockQuery(tables[tableName] ?? []));
  knex.transaction = vi.fn(async (callback: (trx: any) => Promise<any>) => callback(knex));
  return { knex };
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
    listAvailableTeamsActionsMock.mockResolvedValue([]);
    createTicketWithRetryMock.mockResolvedValue({
      ticket_id: 'ticket-created-1',
      ticket_number: 'T-4001',
      title: 'VPN outage from Teams',
      tenant: 'tenant-1',
      entered_at: '2026-03-07T12:00:00.000Z',
    });
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
    createTenantKnexMock.mockResolvedValue(createTenantKnexFixture());
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

  it('T321/T341/T357/T359/T361: create-ticket action builds a Teams task card with captured message context and minimal ticket fields', async () => {
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
        expect.objectContaining({ id: 'title', value: 'VPN outage from Teams' }),
        expect.objectContaining({ id: 'description', value: expect.stringContaining('The VPN has been down since 9 AM.') }),
        expect.objectContaining({ id: 'boardId', choices: [{ title: 'Help Desk', value: 'board-1' }] }),
        expect.objectContaining({ id: 'statusId', choices: [{ title: 'New', value: 'status-1' }] }),
        expect.objectContaining({ id: 'clientId', choices: [{ title: 'Contoso', value: 'client-1' }] }),
        expect.objectContaining({
          id: 'contactId',
          choices: expect.arrayContaining([{ title: 'Taylor Nguyen (Contoso)', value: 'contact-1' }]),
        }),
      ])
    );
    expect((response as any).task.value.card.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'Action.Submit',
          title: 'Create ticket',
          data: expect.objectContaining({
            commandId: 'createTicketFromMessage',
            commandContext: 'message',
            messagePayload: expect.objectContaining({
              id: 'message-1',
            }),
            idempotencyKey: expect.any(String),
          }),
        }),
      ])
    );
  });

  it('T322/T342/T358/T360/T362: action commands reject unsupported contexts, missing message payloads, missing setup options, and missing create permission with recoverable task messages', async () => {
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

    createTenantKnexMock.mockResolvedValueOnce(
      createTenantKnexFixture({
        boards: [],
      })
    );
    const missingSetupResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        name: 'composeExtension/fetchTask',
        value: {
          commandId: 'createTicketFromMessage',
          commandContext: 'message',
          messagePayload: {
            subject: 'VPN outage from Teams',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    hasPermissionMock.mockImplementation(async (_user: IUserWithRoles, resource: string, action?: string) => {
      if (resource === 'ticket' && action === 'create') {
        return false;
      }
      return true;
    });
    const forbiddenCreateResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        name: 'composeExtension/fetchTask',
        value: {
          commandId: 'createTicketFromMessage',
          commandContext: 'message',
          messagePayload: {
            subject: 'VPN outage from Teams',
          },
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
    expect(missingSetupResponse).toEqual({
      task: {
        type: 'message',
        value:
          'Teams ticket creation needs at least one active PSA board, one open ticket status, and one active client before a message can be converted into a ticket.',
      },
    });
    expect(forbiddenCreateResponse).toEqual({
      task: {
        type: 'message',
        value: 'You do not have permission to create PSA tickets from Teams messages.',
      },
    });
  });

  it('T357/T359/T361/T363/T365: submitAction creates a ticket from the Teams message, stores source metadata, and returns deep-link confirmation', async () => {
    const response = await handleTeamsMessageExtensionActivity(
      buildActivity({
        name: 'composeExtension/submitAction',
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
          data: {
            commandId: 'createTicketFromMessage',
            commandContext: 'message',
            idempotencyKey: 'teams-message-1',
            title: 'VPN outage from Teams',
            description: 'The VPN has been down since 9 AM.',
            boardId: 'board-1',
            statusId: 'status-1',
            clientId: 'client-1',
            contactId: 'contact-1',
            messagePayload: {
              id: 'message-1',
            },
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(createTicketWithRetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'VPN outage from Teams',
        description: 'The VPN has been down since 9 AM.',
        board_id: 'board-1',
        status_id: 'status-1',
        client_id: 'client-1',
        contact_id: 'contact-1',
        priority_id: 'priority-1',
        source: 'teams_message_extension',
        attributes: expect.objectContaining({
          idempotency_key: 'teams-message-1',
          teams_message_source: expect.objectContaining({
            message_id: 'message-1',
            subject: 'VPN outage from Teams',
            author: 'Morgan Message',
            link_to_message: 'https://teams.example.test/messages/1',
          }),
        }),
      }),
      'tenant-1',
      expect.any(Function),
      {},
      expect.any(Object),
      expect.any(Object),
      'user-1',
      3
    );
    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'open_record',
        surface: 'message_extension',
        target: {
          entityType: 'ticket',
          ticketId: 'ticket-created-1',
        },
      })
    );
    expect(response).toMatchObject({
      task: {
        type: 'continue',
        value: {
          title: 'Ticket created',
          card: {
            actions: expect.arrayContaining([
              expect.objectContaining({ type: 'Action.OpenUrl', title: 'Open in Teams tab', url: 'https://teams.test/ticket' }),
              expect.objectContaining({ type: 'Action.OpenUrl', title: 'Open in full PSA', url: '/msp/ticket' }),
            ]),
          },
        },
      },
    });
  });

  it('T358/T360/T362/T364/T366: submitAction rejects missing or invalid create-ticket inputs with recoverable task messages', async () => {
    const missingFieldsResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        name: 'composeExtension/submitAction',
        value: {
          commandId: 'createTicketFromMessage',
          commandContext: 'message',
          messagePayload: {
            subject: 'VPN outage from Teams',
            body: {
              content: '<div>The VPN has been down since 9 AM.</div>',
            },
          },
          data: {
            commandId: 'createTicketFromMessage',
            commandContext: 'message',
            idempotencyKey: 'teams-message-2',
            title: 'VPN outage from Teams',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    const mismatchedContactKnex = createTenantKnexFixture({
      contacts: [
        {
          contact_name_id: 'contact-1',
          client_id: 'client-2',
        },
      ],
    });
    createTenantKnexMock.mockResolvedValueOnce(mismatchedContactKnex);
    createTenantKnexMock.mockResolvedValueOnce(mismatchedContactKnex);
    const mismatchedContactResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        name: 'composeExtension/submitAction',
        value: {
          commandId: 'createTicketFromMessage',
          commandContext: 'message',
          messagePayload: {
            subject: 'VPN outage from Teams',
            body: {
              content: '<div>The VPN has been down since 9 AM.</div>',
            },
          },
          data: {
            commandId: 'createTicketFromMessage',
            commandContext: 'message',
            idempotencyKey: 'teams-message-3',
            title: 'VPN outage from Teams',
            description: 'The VPN has been down since 9 AM.',
            boardId: 'board-1',
            statusId: 'status-1',
            clientId: 'client-1',
            contactId: 'contact-1',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(missingFieldsResponse).toEqual({
      task: {
        type: 'message',
        value: 'Select a PSA board, open status, and client before creating a ticket from this Teams message.',
      },
    });
    expect(mismatchedContactResponse).toEqual({
      task: {
        type: 'message',
        value: 'The selected PSA contact does not belong to the selected client.',
      },
    });
  });

  it('T367/T368: submitAction replays duplicate create-ticket submissions safely and rejects missing idempotency state', async () => {
    createTenantKnexMock.mockResolvedValueOnce(
      createTenantKnexFixture({
        tickets: [
          {
            ticket_id: 'ticket-created-1',
            ticket_number: 'T-4001',
            title: 'VPN outage from Teams',
          },
        ],
      })
    );
    const duplicateResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        name: 'composeExtension/submitAction',
        value: {
          commandId: 'createTicketFromMessage',
          commandContext: 'message',
          messagePayload: {
            subject: 'VPN outage from Teams',
            body: {
              content: '<div>The VPN has been down since 9 AM.</div>',
            },
          },
          data: {
            commandId: 'createTicketFromMessage',
            commandContext: 'message',
            idempotencyKey: 'teams-message-4',
            title: 'VPN outage from Teams',
            description: 'The VPN has been down since 9 AM.',
            boardId: 'board-1',
            statusId: 'status-1',
            clientId: 'client-1',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    const missingIdempotencyResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        name: 'composeExtension/submitAction',
        value: {
          commandId: 'createTicketFromMessage',
          commandContext: 'message',
          messagePayload: {
            subject: 'VPN outage from Teams',
            body: {
              content: '<div>The VPN has been down since 9 AM.</div>',
            },
          },
          data: {
            commandId: 'createTicketFromMessage',
            commandContext: 'message',
            title: 'VPN outage from Teams',
            description: 'The VPN has been down since 9 AM.',
            boardId: 'board-1',
            statusId: 'status-1',
            clientId: 'client-1',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(createTicketWithRetryMock).not.toHaveBeenCalled();
    expect(duplicateResponse).toMatchObject({
      task: {
        type: 'continue',
        value: {
          title: 'Ticket created',
        },
      },
    });
    expect(missingIdempotencyResponse).toEqual({
      task: {
        type: 'message',
        value:
          'Reopen the Teams message action before creating a ticket so the submission can be applied safely once.',
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
    listAvailableTeamsActionsMock.mockResolvedValueOnce([
      {
        actionId: 'assign_ticket',
        operation: 'mutation',
        available: true,
      },
      {
        actionId: 'add_note',
        operation: 'mutation',
        available: true,
      },
    ]);

    const response = await handleTeamsMessageExtensionActivity(buildActivity(), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.composeExtension.type).toBe('result');
    expect(response.composeExtension.attachments?.[0]).toEqual(
      expect.objectContaining({
        contentType: 'application/vnd.microsoft.card.hero',
        content: expect.objectContaining({
          title: 'Ticket T-1001',
          text: 'VPN outage • In progress\nQuick actions: Assign ticket, Add note',
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

  it('T333/T334/T339/T340: search results only surface quick actions that are currently available for the tenant and entity', async () => {
    listAvailableTeamsActionsMock
      .mockResolvedValueOnce([
        {
          actionId: 'assign_ticket',
          operation: 'mutation',
          available: true,
        },
        {
          actionId: 'reply_to_contact',
          operation: 'mutation',
          available: false,
        },
      ])
      .mockResolvedValue([]);

    const response = await handleTeamsMessageExtensionActivity(buildActivity(), {
      tenantIdHint: 'tenant-1',
    });

    expect(response.composeExtension.type).toBe('result');
    expect(response.composeExtension.attachments?.[0]?.content.text).toContain('Quick actions: Assign ticket');
    expect(response.composeExtension.attachments?.[0]?.content.text).not.toContain('Reply to contact');
    expect(response.composeExtension.attachments?.[1]?.content.text).not.toContain('Quick actions:');
  });

  it('T353/T354/T355/T356: message-extension search records the invoking surface and reuses existing PSA data-access patterns', async () => {
    await handleTeamsMessageExtensionActivity(buildActivity(), {
      tenantIdHint: 'tenant-1',
    });

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'message_extension',
      })
    );
    expect(TicketService.prototype.search).toHaveBeenCalled();
    expect(ContactService.prototype.search).toHaveBeenCalled();
    expect(createTenantKnexMock).toHaveBeenCalledWith('tenant-1');
    expect(listPendingApprovalsForTeamsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        query: 'vpn',
      })
    );
  });

  it('T327/T328: search supports paged result windows via Teams queryOptions and rejects invalid pagination values', async () => {
    vi.spyOn(TicketService.prototype, 'search').mockResolvedValue([
      { ticket_id: 'ticket-1' } as any,
      { ticket_id: 'ticket-2' } as any,
      { ticket_id: 'ticket-3' } as any,
    ]);
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
    executeTeamsActionMock.mockImplementation(
      async ({ target }: { target: { ticketId?: string; entityType: string } }) => ({
        success: true,
        actionId: 'open_record',
        surface: 'message_extension',
        operation: 'lookup',
        summary: {
          title: `Ticket ${target.ticketId}`,
          text: `Summary for ${target.ticketId}`,
        },
        links: [{ type: 'teams_tab', label: 'Open in Teams tab', url: `https://teams.test/${target.ticketId}` }],
        items: [
          {
            id: target.ticketId || 'record-1',
            title: `Ticket ${target.ticketId}`,
            summary: `Summary for ${target.ticketId}`,
            entityType: 'ticket',
            links: [{ type: 'teams_tab', label: 'Open in Teams tab', url: `https://teams.test/${target.ticketId}` }],
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
      })
    );

    const pagedResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        value: {
          commandId: 'searchRecords',
          commandContext: 'compose',
          parameters: [{ name: 'query', value: 'vpn' }],
          queryOptions: {
            skip: 1,
            count: 2,
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    const invalidPaginationResponse = await handleTeamsMessageExtensionActivity(
      buildActivity({
        value: {
          commandId: 'searchRecords',
          commandContext: 'compose',
          parameters: [{ name: 'query', value: 'vpn' }],
          queryOptions: {
            skip: -1,
            count: 50,
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(pagedResponse.composeExtension.type).toBe('result');
    expect(pagedResponse.composeExtension.attachments?.map((attachment) => attachment.content.title)).toEqual([
      'Ticket ticket-2',
      'Ticket ticket-3',
    ]);
    expect(TicketService.prototype.search).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 3,
      }),
      expect.anything()
    );
    expect(invalidPaginationResponse).toEqual({
      composeExtension: {
        type: 'message',
        text: 'Search pagination must use a non-negative skip value.',
      },
      cacheInfo: {
        cacheType: 'no-cache',
      },
    });
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
