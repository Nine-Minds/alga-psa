import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPermission } from 'server/src/lib/auth/rbac';
import {
  handleTeamsQuickActionActivity,
  handleTeamsQuickActionRequest,
} from '../../../../../../../ee/server/src/lib/teams/quickActions/teamsQuickActionHandler';

const {
  resolveTeamsTenantContextMock,
  resolveTeamsLinkedUserMock,
  getUserWithRolesMock,
  listAvailableTeamsActionsMock,
  executeTeamsActionMock,
  createTenantKnexMock,
  hasPermissionMock,
  getTeamsRuntimeAvailabilityMock,
} = vi.hoisted(() => ({
  resolveTeamsTenantContextMock: vi.fn(),
  resolveTeamsLinkedUserMock: vi.fn(),
  getUserWithRolesMock: vi.fn(),
  listAvailableTeamsActionsMock: vi.fn(),
  executeTeamsActionMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  getTeamsRuntimeAvailabilityMock: vi.fn(),
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

vi.mock('../../../../../../../ee/server/src/lib/teams/resolveTeamsTenantContext', () => ({
  resolveTeamsTenantContext: resolveTeamsTenantContextMock,
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/resolveTeamsLinkedUser', () => ({
  resolveTeamsLinkedUser: resolveTeamsLinkedUserMock,
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/actions/teamsActionRegistry', () => ({
  executeTeamsAction: executeTeamsActionMock,
  listAvailableTeamsActions: listAvailableTeamsActionsMock,
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/getTeamsRuntimeAvailability', () => ({
  getTeamsRuntimeAvailability: (...args: unknown[]) => getTeamsRuntimeAvailabilityMock(...args),
}));

function buildUser(overrides: Record<string, unknown> = {}) {
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
  } as any;
}

function buildActivity(overrides: Record<string, unknown> = {}) {
  return {
    type: 'invoke',
    name: 'task/fetch',
    from: {
      aadObjectId: 'aad-user-1',
    },
    channelData: {
      tenant: {
        id: 'entra-tenant-1',
      },
    },
    value: {
      actionId: 'add_note',
      target: {
        entityType: 'ticket',
        ticketId: 'ticket-1',
      },
      messagePayload: {
        subject: 'Forwarded from Teams',
        body: {
          content: '<div>Prefill this from Teams.</div>',
        },
        from: {
          user: {
            displayName: 'Jordan Message',
          },
        },
      },
    },
    ...overrides,
  } as any;
}

describe('teamsQuickActionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();

    resolveTeamsTenantContextMock.mockResolvedValue({
      status: 'resolved',
      tenantId: 'tenant-1',
      installStatus: 'active',
      enabledCapabilities: ['personal_bot', 'message_extension'],
      appId: 'teams-app-1',
      botId: 'teams-bot-1',
      microsoftTenantId: 'entra-tenant-1',
    });
    resolveTeamsLinkedUserMock.mockResolvedValue({
      status: 'linked',
      tenantId: 'tenant-1',
      userId: 'user-1',
      matchedBy: 'provider_account_id',
    });
    getUserWithRolesMock.mockResolvedValue(buildUser());
    hasPermissionMock.mockResolvedValue(true);
    getTeamsRuntimeAvailabilityMock.mockResolvedValue(null);
    listAvailableTeamsActionsMock.mockResolvedValue([
      {
        actionId: 'assign_ticket',
        available: true,
        operation: 'mutation',
      },
      {
        actionId: 'add_note',
        available: true,
        operation: 'mutation',
      },
      {
        actionId: 'reply_to_contact',
        available: true,
        operation: 'mutation',
      },
      {
        actionId: 'log_time',
        available: true,
        operation: 'mutation',
      },
      {
        actionId: 'approval_response',
        available: true,
        operation: 'mutation',
      },
    ]);
    createTenantKnexMock.mockResolvedValue({
      knex: vi.fn((table: string) => {
        if (table === 'users') {
          return {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([
              {
                user_id: 'user-1',
                first_name: 'Alex',
                last_name: 'Tech',
                email: 'alex@example.test',
              },
              {
                user_id: 'user-2',
                first_name: 'Jamie',
                last_name: 'Rivera',
                email: 'jamie@example.test',
              },
            ]),
          };
        }

        return {
          where: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        };
      }),
    });
    executeTeamsActionMock.mockImplementation(async ({ actionId, target }: { actionId: string; target?: Record<string, string> }) => {
      if (actionId === 'open_record') {
        const entityType = target?.entityType || 'ticket';
        return {
          success: true,
          actionId,
          surface: 'quick_action',
          operation: 'lookup',
          summary: {
            title: entityType === 'project_task' ? 'Project task VPN cleanup' : 'Ticket T-1001',
            text:
              entityType === 'project_task'
                ? 'VPN cleanup for onboarding'
                : 'VPN outage • In progress',
          },
          links: [
            { type: 'teams_tab', label: 'Open in Teams tab', url: `https://teams.test/${entityType}` },
            { type: 'psa', label: 'Open in full PSA', url: `/msp/${entityType}` },
          ],
          items: [],
          warnings: [],
          metadata: {
            surface: 'quick_action',
            idempotencyKey: null,
            idempotentReplay: false,
            invokingSurface: 'quick_action',
            businessOperations: ['TicketService.getById'],
          },
        };
      }

      return {
        success: true,
        actionId,
        surface: 'quick_action',
        operation: 'mutation',
        summary: {
          title: 'Quick action complete',
          text: 'The Teams quick action completed successfully.',
        },
        links: [
          { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/ticket' },
          { type: 'psa', label: 'Open in full PSA', url: '/msp/ticket' },
        ],
        items: [],
        warnings: [],
        metadata: {
          surface: 'quick_action',
          idempotencyKey: null,
          idempotentReplay: false,
          invokingSurface: 'quick_action',
          businessOperations: ['TicketService.addComment'],
        },
      };
    });
  });

  it('T395/T397/T399/T401/T403/T405/T417/T419: fetch builds minimal quick-action forms for currently allowed actions with prefills and Teams-tab handoff links', async () => {
    const cases = [
      { actionId: 'assign_ticket', expectedIds: ['assigneeId', 'note'] },
      { actionId: 'add_note', expectedIds: ['note'] },
      { actionId: 'reply_to_contact', expectedIds: ['reply'] },
      { actionId: 'log_time', expectedIds: ['durationMinutes', 'note', 'isBillable'] },
      { actionId: 'approval_response', expectedIds: ['outcome', 'comment'], target: { entityType: 'approval', approvalId: 'approval-1' } },
    ] as const;

    for (const testCase of cases) {
      const response = await handleTeamsQuickActionActivity(
        buildActivity({
          value: {
            actionId: testCase.actionId,
            target: testCase.target || {
              entityType: 'ticket',
              ticketId: 'ticket-1',
            },
            messagePayload: {
              subject: 'Forwarded from Teams',
              body: {
                content: '<div>Prefill this from Teams.</div>',
              },
            },
          },
        }),
        { tenantIdHint: 'tenant-1' }
      );

      expect(response.task.type).toBe('continue');
      expect((response.task.value as any).card.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'Action.Submit', title: 'Submit' }),
          expect.objectContaining({ type: 'Action.Submit', title: 'Cancel' }),
          expect.objectContaining({ type: 'Action.OpenUrl', title: 'Open in Teams tab' }),
        ])
      );
      for (const expectedId of testCase.expectedIds) {
        expect((response.task.value as any).card.body).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: expectedId })])
        );
      }
    }
  });

  it('T396/T398/T400/T402/T404/T406/T418/T420: fetch returns recoverable messaging or tab handoff when a quick action is unavailable or exceeds quick-action complexity limits', async () => {
    listAvailableTeamsActionsMock.mockResolvedValueOnce([
      {
        actionId: 'reply_to_contact',
        available: false,
        operation: 'mutation',
        message: 'This Teams quick action is disabled for the tenant.',
      },
    ]);

    const unavailableResponse = await handleTeamsQuickActionActivity(
      buildActivity({
        value: {
          actionId: 'reply_to_contact',
          target: {
            entityType: 'ticket',
            ticketId: 'ticket-1',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    const missingActionResponse = await handleTeamsQuickActionActivity(
      buildActivity({
        value: {
          target: {
            entityType: 'ticket',
            ticketId: 'ticket-1',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(unavailableResponse).toMatchObject({
      task: {
        type: 'continue',
        value: {
          title: 'Continue in Teams tab',
        },
      },
    });
    expect(missingActionResponse).toEqual({
      task: {
        type: 'message',
        value: 'Select a supported Teams quick action before continuing.',
      },
    });
  });

  it('T233/T234/T407/T409/T411: submit validates inputs through the quick-action form, calls the shared action layer, and returns success confirmations', async () => {
    await handleTeamsQuickActionActivity(
      buildActivity({
        name: 'task/submit',
        value: {
          actionId: 'assign_ticket',
          target: {
            entityType: 'ticket',
            ticketId: 'ticket-1',
          },
          data: {
            actionId: 'assign_ticket',
            assigneeId: 'user-2',
            note: 'Assigning from Teams',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    await handleTeamsQuickActionActivity(
      buildActivity({
        name: 'task/submit',
        value: {
          actionId: 'log_time',
          target: {
            entityType: 'project_task',
            taskId: 'task-1',
            projectId: 'project-1',
          },
          data: {
            actionId: 'log_time',
            durationMinutes: '45',
            note: 'Worked from Teams',
            isBillable: 'false',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'assign_ticket',
        surface: 'quick_action',
        input: expect.objectContaining({
          assigneeId: 'user-2',
          note: 'Assigning from Teams',
        }),
      })
    );
    expect(executeTeamsActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'log_time',
        surface: 'quick_action',
        target: {
          entityType: 'project_task',
          taskId: 'task-1',
          projectId: 'project-1',
        },
        input: expect.objectContaining({
          entityType: 'project_task',
          workItemId: 'task-1',
          durationMinutes: 45,
          note: 'Worked from Teams',
          isBillable: false,
        }),
      })
    );
  });

  it('T408/T410/T412/T413/T414: submit returns recoverable validation and shared-action failure responses', async () => {
    const validationResponse = await handleTeamsQuickActionActivity(
      buildActivity({
        name: 'task/submit',
        value: {
          actionId: 'add_note',
          target: {
            entityType: 'ticket',
            ticketId: 'ticket-1',
          },
          data: {
            actionId: 'add_note',
            note: '',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    executeTeamsActionMock.mockResolvedValueOnce({
      success: false,
      actionId: 'approval_response',
      surface: 'quick_action',
      operation: 'mutation',
      error: {
        code: 'forbidden',
        message: 'You do not have permission to respond to approvals from Teams.',
        remediation: 'Open the full PSA application if you need broader access.',
      },
      warnings: [],
      metadata: {
        surface: 'quick_action',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'quick_action',
        businessOperations: ['TimeSheetService.approveTimeSheet'],
      },
    });

    const failureResponse = await handleTeamsQuickActionActivity(
      buildActivity({
        name: 'task/submit',
        value: {
          actionId: 'approval_response',
          target: {
            entityType: 'approval',
            approvalId: 'approval-1',
          },
          data: {
            actionId: 'approval_response',
            outcome: 'approve',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(validationResponse).toEqual({
      task: {
        type: 'message',
        value: 'Enter the note before submitting this Teams quick action.',
      },
    });
    expect(failureResponse).toEqual({
      task: {
        type: 'message',
        value:
          'You do not have permission to respond to approvals from Teams. Open the full PSA application if you need broader access.',
      },
    });
  });

  it('T415/T416: cancel dismisses the quick action without side effects', async () => {
    const response = await handleTeamsQuickActionActivity(
      buildActivity({
        name: 'task/submit',
        value: {
          actionId: 'add_note',
          target: {
            entityType: 'ticket',
            ticketId: 'ticket-1',
          },
          data: {
            actionId: 'add_note',
            command: 'cancel',
          },
        },
      }),
      { tenantIdHint: 'tenant-1' }
    );

    expect(response).toEqual({
      task: {
        type: 'message',
        value: 'The Teams quick action was dismissed without saving changes.',
      },
    });
    expect(executeTeamsActionMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'add_note',
        surface: 'quick_action',
      })
    );
  });

  it('handles invalid JSON request bodies with a 400 response', async () => {
    const response = await handleTeamsQuickActionRequest(
      new Request('https://example.test/api/teams/quick-actions', {
        method: 'POST',
        body: 'not-json',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: 'invalid_json',
      message: 'The Teams quick-action request body must be valid JSON.',
    });
  });

});
