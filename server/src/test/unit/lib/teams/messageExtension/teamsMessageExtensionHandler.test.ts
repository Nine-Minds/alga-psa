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

  it('T312/T314/T316/T318: search suppresses entity types the user cannot read and returns a recoverable empty-state message', async () => {
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

  it('T319/T320: search works from compose and command-box contexts and rejects unsupported contexts with recoverable guidance', async () => {
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
});
