// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketCloseValidationError } from '../lib/closeRuleConstants';

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const revalidatePathMock = vi.fn();
const updateTicketWithCacheMock = vi.fn();
const updateTicketInTransactionMock = vi.fn();
const addTicketCommentWithCacheMock = vi.fn();
const addTicketCommentInTransactionMock = vi.fn();
const hasPermissionMock = vi.fn();
const createTagsForEntityWithTransactionMock = vi.fn();
const findTagsByEntityIdsMock = vi.fn();
const assignTeamToTicketMock = vi.fn();
const removeTeamFromTicketMock = vi.fn();

const getDefaultStatusIdMock = vi.fn();
const validateStatusBelongsToBoardMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action({ user_id: 'internal-user-1', user_type: 'internal', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
  // The real one resolves the caller's locale; with no request scope here it
  // would return the payload unchanged anyway.
  localizeActionError: async (result: unknown) => result,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
  }),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: {
    getDefaultStatusId: (...args: any[]) => getDefaultStatusIdMock(...args),
    validateStatusBelongsToBoard: (...args: any[]) => validateStatusBelongsToBoardMock(...args),
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: any[]) => revalidatePathMock(...args),
}));

vi.mock('./optimizedTicketActions', () => ({
  updateTicketWithCache: (...args: any[]) => updateTicketWithCacheMock(...args),
  updateTicketInTransaction: (...args: any[]) => updateTicketInTransactionMock(...args),
  addTicketCommentWithCache: (...args: any[]) => addTicketCommentWithCacheMock(...args),
  addTicketCommentInTransaction: (...args: any[]) => addTicketCommentInTransactionMock(...args),
}));

vi.mock('../models/ticket', () => ({
  default: {},
}));

vi.mock('@alga-psa/core', () => ({
  deleteEntityWithValidation: vi.fn(),
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: vi.fn(),
}));

vi.mock('@alga-psa/tags/actions', () => ({
  createTagsForEntityWithTransaction: (...args: any[]) => createTagsForEntityWithTransactionMock(...args),
  findTagsByEntityIds: (...args: any[]) => findTagsByEntityIdsMock(...args),
}));

// ticketActions imports the deep modules, not the barrel — mock those too so
// the real tagActions (which needs withOptionalAuth at module load) never loads.
vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntityWithTransaction: (...args: any[]) => createTagsForEntityWithTransactionMock(...args),
  findTagsByEntityIds: (...args: any[]) => findTagsByEntityIdsMock(...args),
}));

vi.mock('@alga-psa/tags/actions/tagActionErrors', () => ({
  isTagActionError: () => false,
}));

vi.mock('./teamAssignmentActions', () => ({
  assignTeamToTicket: (...args: any[]) => assignTeamToTicketMock(...args),
  removeTeamFromTicket: (...args: any[]) => removeTeamFromTicketMock(...args),
}));

vi.mock('@alga-psa/validation', () => ({
  validateData: vi.fn((_schema: unknown, data: unknown) => data),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({
    publish: vi.fn(),
  })),
}));

vi.mock('@alga-psa/event-bus/events', () => ({
  TicketCreatedEvent: class {},
  TicketUpdatedEvent: class {},
  TicketClosedEvent: class {},
  TicketResponseStateChangedEvent: class {},
}));

vi.mock('@alga-psa/shared/services/tickets/ticketModelEventPublisher', () => ({
  TicketModelEventPublisher: class {},
}));

vi.mock('../lib/adapters/TicketModelAnalyticsTracker', () => ({
  TicketModelAnalyticsTracker: class {},
}));

vi.mock('../lib/workflowTicketTransitionEvents', () => ({
  buildTicketTransitionWorkflowEvents: vi.fn(() => []),
}));

vi.mock('../lib/workflowTicketCommunicationEvents', () => ({
  buildTicketCommunicationWorkflowEvents: vi.fn(() => []),
}));

vi.mock('../lib/ticketOrigin', () => ({
  getTicketOrigin: vi.fn(),
}));

vi.mock('@alga-psa/shared/services/tickets/ticketSlaStageEvents', () => ({
  buildTicketResolutionSlaStageCompletionEvent: vi.fn(),
  buildTicketResolutionSlaStageEnteredEvent: vi.fn(),
}));

vi.mock('@alga-psa/sla/services', () => ({
  SlaBackendFactory: {},
}));

function createKnexWithStatus(status: Record<string, any> | undefined) {
  return ((table: string) => {
    const api: any = {
      where: () => api,
      first: async () => (table === 'statuses' ? status : undefined),
    };
    return api;
  }) as any;
}

const PARAGRAPH = (text: string) => JSON.stringify([
  {
    type: 'paragraph',
    props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
    content: [{ type: 'text', text, styles: {} }],
  },
]);

describe('ticketActions bulk status resolution comment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    updateTicketInTransactionMock.mockResolvedValue('success');
    addTicketCommentInTransactionMock.mockResolvedValue({ comment_id: 'comment-1' });
    // A distinct trx per withTransaction call, like the real per-ticket transactions.
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback({ trxId: Symbol('trx') }));
  });

  it('writes the resolution on each ticket before the closing status change', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: createKnexWithStatus({ status_id: 'status-closed', is_closed: true }) });

    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    const result = await bulkUpdateTicketStatus(['ticket-1', 'ticket-2'], 'status-closed', {
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
      resolutionComment: { text: '  Replaced the failed switch.  ', isInternal: true },
    });

    expect(result).toEqual({ updatedIds: ['ticket-1', 'ticket-2'], failed: [] });
    for (const [index, ticketId] of ['ticket-1', 'ticket-2'].entries()) {
      expect(addTicketCommentInTransactionMock).toHaveBeenNthCalledWith(
        index + 1,
        expect.anything(),
        expect.objectContaining({ user_id: 'internal-user-1' }),
        'tenant-1',
        {
          ticketId,
          content: PARAGRAPH('Replaced the failed switch.'),
          isInternal: true,
          isResolution: true,
          closesTicket: true,
          notificationSuppression: { suppressContactNotifications: true, suppressInternalNotifications: true },
        },
      );
    }
    // The resolution payload never reaches the ticket update itself.
    expect(updateTicketInTransactionMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ user_id: 'internal-user-1' }),
      'tenant-1',
      'ticket-1',
      { status_id: 'status-closed' },
      { suppressContactNotifications: true, suppressInternalNotifications: true },
    );
  });

  it('defaults the resolution to client-visible', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: createKnexWithStatus({ status_id: 'status-closed', is_closed: true }) });

    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    await bulkUpdateTicketStatus(['ticket-1'], 'status-closed', {
      resolutionComment: { text: 'Cleared the queue.' },
    });

    expect(addTicketCommentInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'tenant-1',
      {
        ticketId: 'ticket-1',
        content: PARAGRAPH('Cleared the queue.'),
        isInternal: false,
        isResolution: true,
        closesTicket: true,
        notificationSuppression: { suppressContactNotifications: undefined, suppressInternalNotifications: undefined },
      },
    );
  });

  it('drops the resolution when the target status does not close', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: createKnexWithStatus({ status_id: 'status-open', is_closed: false }) });

    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    const result = await bulkUpdateTicketStatus(['ticket-1'], 'status-open', {
      resolutionComment: { text: 'Not a resolution.', isInternal: false },
    });

    expect(result).toEqual({ updatedIds: ['ticket-1'], failed: [] });
    expect(addTicketCommentInTransactionMock).not.toHaveBeenCalled();
  });

  it('skips blank resolution text without looking up the status', async () => {
    const knex = createKnexWithStatus({ status_id: 'status-closed', is_closed: true });
    createTenantKnexMock.mockResolvedValue({ knex });

    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    await bulkUpdateTicketStatus(['ticket-1'], 'status-closed', {
      resolutionComment: { text: '   ' },
    });

    expect(addTicketCommentInTransactionMock).not.toHaveBeenCalled();
    expect(updateTicketInTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('writes the comment and the status change on the same trx, one transaction per ticket', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: createKnexWithStatus({ status_id: 'status-closed', is_closed: true }) });

    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    await bulkUpdateTicketStatus(['ticket-1', 'ticket-2'], 'status-closed', {
      resolutionComment: { text: 'Fixed.' },
    });

    expect(withTransactionMock).toHaveBeenCalledTimes(2);
    expect(addTicketCommentInTransactionMock).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 2; i += 1) {
      const commentTrx = addTicketCommentInTransactionMock.mock.calls[i][0];
      const statusTrx = updateTicketInTransactionMock.mock.calls[i][0];
      expect(commentTrx).toBe(statusTrx);
    }
    expect(addTicketCommentInTransactionMock.mock.calls[0][0]).not.toBe(addTicketCommentInTransactionMock.mock.calls[1][0]);
    // Comment is written before the status change.
    expect(addTicketCommentInTransactionMock.mock.invocationCallOrder[0])
      .toBeLessThan(updateTicketInTransactionMock.mock.invocationCallOrder[0]);
    expect(addTicketCommentWithCacheMock).not.toHaveBeenCalled();
  });

  it('reports a close-rule failure per ticket with closeRuleFailures and keeps partial success', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: createKnexWithStatus({ status_id: 'status-closed', is_closed: true }) });
    const failures = [{ rule: 'time_entry', message: 'Time entry required' }] as any;
    updateTicketInTransactionMock
      .mockResolvedValueOnce('success')
      .mockRejectedValueOnce(new TicketCloseValidationError(failures));

    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    const result = await bulkUpdateTicketStatus(['ticket-1', 'ticket-2'], 'status-closed', {
      resolutionComment: { text: 'Fixed.' },
    });

    expect(result.updatedIds).toEqual(['ticket-1']);
    expect(result.failed).toEqual([
      {
        ticketId: 'ticket-2',
        message: 'Ticket cannot be closed: Time entry required',
        closeRuleFailures: failures,
      },
    ]);
    // The comment was written inside the same callback that rejected, so the
    // real withTransaction rolls it back.
    expect(addTicketCommentInTransactionMock).toHaveBeenCalledTimes(2);
    expect(addTicketCommentInTransactionMock.mock.calls[1][0]).toBe(updateTicketInTransactionMock.mock.calls[1][0]);
  });

  it('surfaces an expected comment error and leaves the status untouched', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: createKnexWithStatus({ status_id: 'status-closed', is_closed: true }) });
    addTicketCommentInTransactionMock.mockRejectedValueOnce(new Error('Only MSP users can create internal comments'));

    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    const result = await bulkUpdateTicketStatus(['ticket-1', 'ticket-2'], 'status-closed', {
      resolutionComment: { text: 'Internal only.', isInternal: true },
    });

    expect(result.updatedIds).toEqual(['ticket-2']);
    expect(result.failed).toEqual([
      { ticketId: 'ticket-1', message: 'Only MSP users can create internal comments' },
    ]);
    expect(updateTicketInTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateTicketInTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'tenant-1',
      'ticket-2',
      { status_id: 'status-closed' },
      {},
    );
  });

  it('uses a generic message for an unexpected comment error and skips the status update', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: createKnexWithStatus({ status_id: 'status-closed', is_closed: true }) });
    addTicketCommentInTransactionMock.mockRejectedValueOnce(new Error('connection reset'));

    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    const result = await bulkUpdateTicketStatus(['ticket-1'], 'status-closed', {
      resolutionComment: { text: 'Fixed.' },
    });

    expect(result.updatedIds).toEqual([]);
    expect(result.failed).toEqual([{ ticketId: 'ticket-1', message: 'Failed to add resolution comment' }]);
    expect(updateTicketInTransactionMock).not.toHaveBeenCalled();
  });

  it('uses the status fallback message when the status change fails unexpectedly', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: createKnexWithStatus({ status_id: 'status-closed', is_closed: true }) });
    updateTicketInTransactionMock.mockRejectedValueOnce(new Error('boom'));

    const { bulkUpdateTicketStatus } = await import('./ticketActions');
    const result = await bulkUpdateTicketStatus(['ticket-1'], 'status-closed', {
      resolutionComment: { text: 'Fixed.' },
    });

    expect(result.failed).toEqual([{ ticketId: 'ticket-1', message: 'Failed to update status' }]);
  });
});
