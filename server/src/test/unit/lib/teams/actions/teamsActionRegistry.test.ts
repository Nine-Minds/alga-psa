import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';
import { ContactService } from 'server/src/lib/api/services/ContactService';
import { ProjectService } from 'server/src/lib/api/services/ProjectService';
import { TicketService } from 'server/src/lib/api/services/TicketService';
import { TimeEntryService } from 'server/src/lib/api/services/TimeEntryService';
import { TimeSheetService } from 'server/src/lib/api/services/TimeSheetService';
import {
  executeTeamsAction,
  listAvailableTeamsActions,
  listTeamsActionDefinitions,
  normalizeTeamsActionRequest,
  resetTeamsActionIdempotencyCache,
  resolveTeamsActionTarget,
} from '../../../../../../../ee/server/src/lib/teams/actions/teamsActionRegistry';

const {
  getTeamsIntegrationExecutionStateMock,
  buildTeamsBotResultDeepLinkFromPsaUrlMock,
  buildTeamsMessageExtensionResultDeepLinkFromPsaUrlMock,
  buildTeamsPersonalTabDeepLinkFromPsaUrlMock,
  hasPermissionMock,
  createTenantKnexMock,
  getReportsToSubordinateIdsMock,
  isFeatureFlagEnabledMock,
} = vi.hoisted(() => ({
  getTeamsIntegrationExecutionStateMock: vi.fn(),
  buildTeamsBotResultDeepLinkFromPsaUrlMock: vi.fn(),
  buildTeamsMessageExtensionResultDeepLinkFromPsaUrlMock: vi.fn(),
  buildTeamsPersonalTabDeepLinkFromPsaUrlMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
  getReportsToSubordinateIdsMock: vi.fn(),
  isFeatureFlagEnabledMock: vi.fn(),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: createTenantKnexMock,
    User: {
      getReportsToSubordinateIds: getReportsToSubordinateIdsMock,
    },
  };
});

vi.mock('@alga-psa/core', () => ({
  isFeatureFlagEnabled: isFeatureFlagEnabledMock,
}));

vi.mock('../../../../../../../ee/server/src/lib/actions/integrations/teamsActions', () => ({
  getTeamsIntegrationExecutionStateImpl: getTeamsIntegrationExecutionStateMock,
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/teamsDeepLinks', () => ({
  buildTeamsBotResultDeepLinkFromPsaUrl: buildTeamsBotResultDeepLinkFromPsaUrlMock,
  buildTeamsMessageExtensionResultDeepLinkFromPsaUrl: buildTeamsMessageExtensionResultDeepLinkFromPsaUrlMock,
  buildTeamsPersonalTabDeepLinkFromPsaUrl: buildTeamsPersonalTabDeepLinkFromPsaUrlMock,
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
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

function buildIntegrationState(overrides: Record<string, unknown> = {}) {
  return {
    selectedProfileId: 'profile-1',
    installStatus: 'active',
    enabledCapabilities: ['personal_bot', 'message_extension', 'personal_tab', 'activity_notifications'],
    allowedActions: ['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response'],
    appId: 'teams-app-1',
    packageMetadata: {
      baseUrl: 'https://example.test',
    },
    ...overrides,
  };
}

describe('teamsActionRegistry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetTeamsActionIdempotencyCache();

    getTeamsIntegrationExecutionStateMock.mockResolvedValue(buildIntegrationState());
    hasPermissionMock.mockResolvedValue(true);
    buildTeamsBotResultDeepLinkFromPsaUrlMock.mockReturnValue('https://teams.test/bot-link');
    buildTeamsMessageExtensionResultDeepLinkFromPsaUrlMock.mockReturnValue('https://teams.test/message-link');
    buildTeamsPersonalTabDeepLinkFromPsaUrlMock.mockReturnValue('https://teams.test/tab-link');
    isFeatureFlagEnabledMock.mockResolvedValue(false);
    getReportsToSubordinateIdsMock.mockResolvedValue([]);
    createTenantKnexMock.mockResolvedValue({
      knex: Object.assign(
        vi.fn(() => {
          const query = Promise.resolve([]) as any;
          const builder = {
            join: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            whereIn: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            distinct: vi.fn().mockReturnThis(),
            then: query.then.bind(query),
            catch: query.catch.bind(query),
            finally: query.finally.bind(query),
          };
          return builder;
        }),
        {
          ref: vi.fn((value: string) => value),
        }
      ),
    });
  });

  it('exposes reusable Teams action definitions with declared inputs, targets, operations, and business-operation metadata', () => {
    const definitions = listTeamsActionDefinitions();

    expect(definitions.map((definition) => definition.id)).toEqual([
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
    ]);

    expect(definitions.find((definition) => definition.id === 'open_record')).toMatchObject({
      operation: 'lookup',
      targetEntityTypes: ['ticket', 'project_task', 'approval', 'time_entry', 'contact'],
      requiredInputs: [
        expect.objectContaining({
          name: 'target',
          type: 'entity',
          required: true,
        }),
      ],
      businessOperations: [
        'TicketService.getById',
        'ProjectService.getTaskById',
        'TimeSheetService.getById',
        'TimeEntryService.getById',
        'ContactService.getById',
      ],
    });

    expect(definitions.find((definition) => definition.id === 'assign_ticket')).toMatchObject({
      operation: 'mutation',
      targetEntityTypes: ['ticket'],
      businessOperations: ['TicketService.update', 'TicketService.addComment'],
    });
  });

  it('normalizes Teams action input into PSA-ready request shapes using target context', () => {
    const normalized = normalizeTeamsActionRequest({
      actionId: 'add_note',
      surface: 'bot',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'ticket',
        ticketId: 'ticket-42',
      },
      input: {
        note: 'Followed up from Teams',
      },
    });

    expect(normalized.action.id).toBe('add_note');
    expect(normalized.normalizedInput).toEqual({
      note: 'Followed up from Teams',
      ticketId: 'ticket-42',
    });
    expect(normalized.targetReference).toEqual({
      entityType: 'ticket',
      ticketId: 'ticket-42',
    });
  });

  it('resolves ticket, project-task, approval, time-entry, and contact targets through shared entity resolvers', async () => {
    vi.spyOn(TicketService.prototype, 'getById').mockResolvedValue({ ticket_id: 'ticket-1' } as any);
    vi.spyOn(ProjectService.prototype, 'getTaskById').mockResolvedValue({ task_id: 'task-1', project_id: 'project-1' } as any);
    vi.spyOn(TimeSheetService.prototype, 'getById').mockResolvedValue({ id: 'approval-1' } as any);
    vi.spyOn(TimeEntryService.prototype, 'getById').mockResolvedValue({ entry_id: 'entry-1' } as any);
    vi.spyOn(ContactService.prototype, 'getById').mockResolvedValue({ contact_name_id: 'contact-1', client_id: 'client-1' } as any);

    const user = buildUser();

    await expect(
      resolveTeamsActionTarget('tenant-1', user, { entityType: 'ticket', ticketId: 'ticket-1' })
    ).resolves.toMatchObject({
      entityType: 'ticket',
      destination: { type: 'ticket', ticketId: 'ticket-1' },
    });

    await expect(
      resolveTeamsActionTarget('tenant-1', user, { entityType: 'project_task', taskId: 'task-1' })
    ).resolves.toMatchObject({
      entityType: 'project_task',
      destination: { type: 'project_task', projectId: 'project-1', taskId: 'task-1' },
    });

    await expect(
      resolveTeamsActionTarget('tenant-1', user, { entityType: 'approval', approvalId: 'approval-1' })
    ).resolves.toMatchObject({
      entityType: 'approval',
      destination: { type: 'approval', approvalId: 'approval-1' },
    });

    await expect(
      resolveTeamsActionTarget('tenant-1', user, { entityType: 'time_entry', entryId: 'entry-1' })
    ).resolves.toMatchObject({
      entityType: 'time_entry',
      destination: { type: 'time_entry', entryId: 'entry-1' },
    });

    await expect(
      resolveTeamsActionTarget('tenant-1', user, { entityType: 'contact', contactId: 'contact-1' })
    ).resolves.toMatchObject({
      entityType: 'contact',
      destination: { type: 'contact', contactId: 'contact-1', clientId: 'client-1' },
    });
  });

  it('computes available actions from the shared registry with tenant action gating and entity compatibility', async () => {
    getTeamsIntegrationExecutionStateMock.mockResolvedValue(
      buildIntegrationState({
        allowedActions: ['assign_ticket', 'reply_to_contact', 'log_time', 'approval_response'],
      })
    );

    const actions = await listAvailableTeamsActions({
      surface: 'bot',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'ticket',
        ticketId: 'ticket-1',
      },
    });

    expect(actions.find((action) => action.actionId === 'assign_ticket')).toMatchObject({
      available: true,
    });
    expect(actions.find((action) => action.actionId === 'add_note')).toMatchObject({
      available: false,
      reason: 'capability_disabled',
    });
    expect(actions.find((action) => action.actionId === 'open_record')).toMatchObject({
      available: true,
    });
    expect(actions.find((action) => action.actionId === 'approval_response')).toMatchObject({
      available: false,
      reason: 'unsupported_action',
    });
  });

  it('maps successful lookup results into Teams-safe summaries with Teams-tab and PSA deep links for the invoking surface', async () => {
    vi.spyOn(TicketService.prototype, 'getById').mockResolvedValue({
      ticket_id: 'ticket-1',
      title: 'Broken VPN',
    } as any);

    const result = await executeTeamsAction({
      actionId: 'open_record',
      surface: 'bot',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'ticket',
        ticketId: 'ticket-1',
      },
    });

    expect(result).toMatchObject({
      success: true,
      actionId: 'open_record',
      surface: 'bot',
      target: {
        entityType: 'ticket',
        id: 'ticket-1',
      },
      metadata: {
        surface: 'bot',
        invokingSurface: 'bot',
        idempotentReplay: false,
      },
    });
    if (result.success) {
      expect(result.links).toEqual([
        {
          type: 'teams_tab',
          label: 'Open in Teams tab',
          url: 'https://teams.test/bot-link',
        },
        {
          type: 'psa',
          label: 'Open in full PSA',
          url: '/msp/tickets/ticket-1',
        },
      ]);
    }
    expect(buildTeamsBotResultDeepLinkFromPsaUrlMock).toHaveBeenCalledWith(
      'https://example.test',
      'teams-app-1',
      'https://example.test/msp/tickets/ticket-1'
    );
  });

  it('lists pending approvals through the shared Teams action registry with approval links and summaries', async () => {
    const approvalRows = [
      {
        id: 'approval-1',
        approval_status: 'SUBMITTED',
        first_name: 'Taylor',
        last_name: 'Nguyen',
        period_start_date: '2026-03-02',
        period_end_date: '2026-03-08',
      },
      {
        id: 'approval-2',
        approval_status: 'CHANGES_REQUESTED',
        first_name: 'Jamie',
        last_name: 'Rivera',
        period_start_date: '2026-02-24',
        period_end_date: '2026-03-01',
      },
    ];

    createTenantKnexMock.mockResolvedValue({
      knex: Object.assign(
        vi.fn(() => {
          const query = Promise.resolve(approvalRows) as any;
          const builder = {
            join: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            whereIn: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            distinct: vi.fn().mockReturnThis(),
            then: query.then.bind(query),
            catch: query.catch.bind(query),
            finally: query.finally.bind(query),
          };
          return builder;
        }),
        {
          ref: vi.fn((value: string) => value),
        }
      ),
    });

    const result = await executeTeamsAction({
      actionId: 'my_approvals',
      surface: 'bot',
      tenantId: 'tenant-1',
      user: buildUser(),
      input: {
        limit: 5,
      },
    });

    expect(result).toMatchObject({
      success: true,
      actionId: 'my_approvals',
      summary: {
        title: 'My approvals',
        text: 'Found 2 approval items ready for review in Teams.',
      },
    });
    if (result.success) {
      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'approval-1',
          title: 'Approval approval-1',
          summary: 'Taylor Nguyen • 2026-03-02 to 2026-03-08 • SUBMITTED',
          entityType: 'approval',
          links: [
            { type: 'teams_tab', label: 'Open in Teams tab', url: 'https://teams.test/bot-link' },
            { type: 'psa', label: 'Open in full PSA', url: '/msp/time-sheet-approvals?approvalId=approval-1' },
          ],
        }),
        expect.objectContaining({
          id: 'approval-2',
          summary: 'Jamie Rivera • 2026-02-24 to 2026-03-01 • CHANGES_REQUESTED',
        }),
      ]);
    }
  });

  it('returns a single validation-error shape when normalized inputs are missing or invalid', async () => {
    const result = await executeTeamsAction({
      actionId: 'add_note',
      surface: 'bot',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'ticket',
        ticketId: 'ticket-1',
      },
      input: {},
    });

    expect(result).toMatchObject({
      success: false,
      actionId: 'add_note',
      error: {
        code: 'validation_error',
        fieldErrors: {
          note: expect.any(String),
        },
      },
      metadata: {
        invokingSurface: 'bot',
      },
    });
  });

  it('wraps mutating ticket actions with central permission checks before calling PSA services', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const updateSpy = vi.spyOn(TicketService.prototype, 'update').mockResolvedValue({ ticket_id: 'ticket-1' } as any);

    const result = await executeTeamsAction({
      actionId: 'assign_ticket',
      surface: 'bot',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'ticket',
        ticketId: 'ticket-1',
      },
      input: {
        assigneeId: 'user-2',
      },
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'forbidden',
      },
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('passes optional Teams message metadata through shared ticket note and reply mutations', async () => {
    const addCommentSpy = vi.spyOn(TicketService.prototype, 'addComment').mockResolvedValue({ comment_id: 'comment-1' } as any);
    vi.spyOn(TicketService.prototype, 'getById').mockResolvedValue({ ticket_id: 'ticket-1', title: 'Broken VPN' } as any);

    await executeTeamsAction({
      actionId: 'add_note',
      surface: 'message_extension',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'ticket',
        ticketId: 'ticket-1',
      },
      input: {
        note: 'Captured from Teams',
        metadata: {
          message_id: 'message-1',
          link_to_message: 'https://teams.example.test/messages/1',
        },
      },
    });

    await executeTeamsAction({
      actionId: 'reply_to_contact',
      surface: 'message_extension',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'ticket',
        ticketId: 'ticket-1',
      },
      input: {
        reply: 'Customer-ready reply from Teams',
        metadata: {
          message_id: 'message-2',
          link_to_message: 'https://teams.example.test/messages/2',
        },
      },
    });

    expect(addCommentSpy).toHaveBeenNthCalledWith(
      1,
      'ticket-1',
      {
        comment_text: 'Captured from Teams',
        is_internal: true,
        metadata: {
          message_id: 'message-1',
          link_to_message: 'https://teams.example.test/messages/1',
        },
      },
      expect.any(Object)
    );
    expect(addCommentSpy).toHaveBeenNthCalledWith(
      2,
      'ticket-1',
      {
        comment_text: 'Customer-ready reply from Teams',
        is_internal: false,
        metadata: {
          message_id: 'message-2',
          link_to_message: 'https://teams.example.test/messages/2',
        },
      },
      expect.any(Object)
    );
  });

  it('deduplicates repeated mutation submits by idempotency key so the underlying mutation only runs once', async () => {
    const updateSpy = vi.spyOn(TicketService.prototype, 'update').mockResolvedValue({ ticket_id: 'ticket-1' } as any);
    const addCommentSpy = vi.spyOn(TicketService.prototype, 'addComment').mockResolvedValue({ comment_id: 'comment-1' } as any);
    vi.spyOn(TicketService.prototype, 'getById').mockResolvedValue({ ticket_id: 'ticket-1', title: 'Broken VPN' } as any);

    const request = {
      actionId: 'assign_ticket' as const,
      surface: 'bot' as const,
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'ticket' as const,
        ticketId: 'ticket-1',
      },
      input: {
        assigneeId: 'user-2',
        note: 'Assigned from Teams',
      },
      idempotencyKey: 'submit-1',
    };

    const first = await executeTeamsAction(request);
    const second = await executeTeamsAction(request);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(addCommentSpy).toHaveBeenCalledTimes(1);
    expect(second.metadata.idempotentReplay).toBe(true);
  });

  it('returns user-readable partial-failure guidance when Teams-tab links cannot be generated but PSA fallback links remain available', async () => {
    getTeamsIntegrationExecutionStateMock.mockResolvedValue(
      buildIntegrationState({
        appId: null,
        packageMetadata: null,
      })
    );
    vi.spyOn(TicketService.prototype, 'getById').mockResolvedValue({ ticket_id: 'ticket-1' } as any);

    const result = await executeTeamsAction({
      actionId: 'open_record',
      surface: 'message_extension',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'ticket',
        ticketId: 'ticket-1',
      },
    });

    expect(result).toMatchObject({
      success: true,
      warnings: [
        {
          code: 'partial_failure',
        },
      ],
    });
    if (result.success) {
      expect(result.links).toEqual([
        {
          type: 'psa',
          label: 'Open in full PSA',
          url: '/msp/tickets/ticket-1',
        },
      ]);
    }
  });

  it('reuses the existing time-entry and approval services for Teams mutations', async () => {
    const createSpy = vi.spyOn(TimeEntryService.prototype, 'create').mockResolvedValue({
      entry_id: 'entry-1',
      project_id: 'project-8',
    } as any);
    const approvalSpy = vi.spyOn(TimeSheetService.prototype, 'requestChanges').mockResolvedValue({ id: 'approval-1' } as any);
    vi.spyOn(ProjectService.prototype, 'getTaskById').mockResolvedValue({ task_id: 'task-9', project_id: 'project-8' } as any);
    vi.spyOn(TimeSheetService.prototype, 'getById').mockResolvedValue({ id: 'approval-1' } as any);

    const logTime = await executeTeamsAction({
      actionId: 'log_time',
      surface: 'bot',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'project_task',
        taskId: 'task-9',
        projectId: 'project-8',
      },
      input: {
        startTime: '2026-03-07T10:00:00.000Z',
        durationMinutes: 30,
        note: 'Worked from Teams',
      },
    });

    expect(logTime.success).toBe(true);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        work_item_type: 'project_task',
        work_item_id: 'task-9',
        start_time: '2026-03-07T10:00:00.000Z',
        end_time: '2026-03-07T10:30:00.000Z',
      }),
      expect.any(Object)
    );

    const approval = await executeTeamsAction({
      actionId: 'approval_response',
      surface: 'bot',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'approval',
        approvalId: 'approval-1',
      },
      input: {
        outcome: 'request_changes',
        comment: 'Please update the submitted notes',
      },
    });

    expect(approval.success).toBe(true);
    expect(approvalSpy).toHaveBeenCalledWith(
      'approval-1',
      {
        change_reason: 'Please update the submitted notes',
        detailed_feedback: 'Please update the submitted notes',
      },
      expect.any(Object)
    );
  });

  it('marks actions unavailable when Teams is not active for the tenant', async () => {
    getTeamsIntegrationExecutionStateMock.mockResolvedValue(
      buildIntegrationState({
        installStatus: 'install_pending',
      })
    );

    const result = await executeTeamsAction({
      actionId: 'open_record',
      surface: 'bot',
      tenantId: 'tenant-1',
      user: buildUser(),
      target: {
        entityType: 'ticket',
        ticketId: 'ticket-1',
      },
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'not_configured',
      },
    });
  });
});
