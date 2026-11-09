// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: null as any,
  comment: null as any,
  hasPermission: vi.fn(),
  authorizeTicketRecordAccess: vi.fn(),
  writes: [] as Array<{ table: string; values?: unknown }>,
  cancelScheduledJob: vi.fn(),
  scheduleJobAt: vi.fn(),
  withdrawCommentAttachments: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(mocks.currentUser, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: any[]) => mocks.hasPermission(...args),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: any, callback: any) => callback(makeTrx()),
  tenantDb: (conn: any) => ({ table: (table: string) => conn(table) }),
  registerAfterCommit: vi.fn(),
}));
vi.mock('../../models/comment', () => ({
  default: { get: async () => mocks.comment },
}));
vi.mock('../../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: (...args: any[]) => mocks.authorizeTicketRecordAccess(...args),
  authorizeTicketRecordAccessConcealed: vi.fn(),
}));
vi.mock('@alga-psa/core', () => ({
  cancelScheduledJob: (...args: any[]) => mocks.cancelScheduledJob(...args),
  scheduleJobAt: (...args: any[]) => mocks.scheduleJobAt(...args),
}));
vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  withdrawCommentAttachments: (...args: any[]) => mocks.withdrawCommentAttachments(...args),
}));
vi.mock('@alga-psa/shared/lib/ticketCommentAttachments', () => ({
  persistCommentPublication: vi.fn(),
  withdrawCommentAttachments: (...args: any[]) => mocks.withdrawCommentAttachments(...args),
}));
vi.mock('@alga-psa/shared/lib/ticketActivity', () => ({
  TICKET_ACTIVITY_ACTOR: { USER: 'user' },
  TICKET_ACTIVITY_ENTITY: { COMMENT: 'comment' },
  TICKET_ACTIVITY_EVENT: {},
  TICKET_ACTIVITY_SOURCE: { UI: 'ui' },
  writeTicketActivity: vi.fn(),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishStoredWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/db/commentEventRegistry', () => ({ publishCommentEvent: vi.fn() }));
vi.mock('../../lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn() }));
vi.mock('../../lib/workflowTicketCommunicationEvents', () => ({ buildTicketCommunicationWorkflowEvents: vi.fn(), publishTicketCommunicationWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/shared/lib/tickets/responseState', () => ({ applyCommentResponseState: vi.fn(), resolveCommentAuthor: vi.fn() }));
vi.mock('@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads', () => ({ buildTicketCommentAddedPayload: vi.fn() }));
vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({ maybeReopenBundleMasterFromChildReply: vi.fn() }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({ convertBlockNoteToMarkdown: vi.fn() }));
vi.mock('@shared/lib/tickets/commentEmailRecipients', () => ({ prepareCommentEmailRecipients: vi.fn() }));
vi.mock('../../lib/cannedResponses/commentMerge', () => ({ resolveCommentMergeTokens: vi.fn() }));

function makeTrx() {
  const trx: any = (table: string) => {
    const builder: any = {
      where: () => builder,
      update: async (values: unknown) => {
        mocks.writes.push({ table, values });
        return 1;
      },
      then: (resolve: (value: unknown[]) => unknown) => resolve([]),
    };
    return builder;
  };
  trx.fn = { now: () => new Date() };
  return trx;
}

import { cancelScheduledComment, rescheduleScheduledComment } from './commentActions';

const scheduledComment = (user_id = 'author-user') => ({
  comment_id: 'comment-1',
  ticket_id: 'ticket-1',
  user_id,
  publish_state: 'scheduled',
  schedule_job_id: 'job-1',
});
const unauthorized = /Permission denied|Cannot access ticket/;

describe('scheduled comment authorization', () => {
  beforeEach(() => {
    mocks.currentUser = { user_id: 'internal-user', user_type: 'internal', roles: [] };
    mocks.comment = scheduledComment();
    mocks.writes = [];
    mocks.hasPermission.mockReset().mockResolvedValue(true);
    mocks.authorizeTicketRecordAccess.mockReset().mockResolvedValue(undefined);
    mocks.cancelScheduledJob.mockReset().mockResolvedValue(undefined);
    mocks.scheduleJobAt.mockReset().mockResolvedValue({ jobId: 'job-2' });
    mocks.withdrawCommentAttachments.mockReset().mockResolvedValue(undefined);
  });

  it('cancel denies even the author when ticket:update is absent', async () => {
    mocks.comment = scheduledComment('internal-user');
    mocks.hasPermission.mockResolvedValue(false);
    await expect(cancelScheduledComment('comment-1')).rejects.toThrow(unauthorized);
    expect(mocks.authorizeTicketRecordAccess).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([]);
    expect(mocks.withdrawCommentAttachments).not.toHaveBeenCalled();
    expect(mocks.cancelScheduledJob).not.toHaveBeenCalled();
  });

  it('cancel denies an authorized role without current parent-ticket access', async () => {
    mocks.authorizeTicketRecordAccess.mockRejectedValue(new Error('Permission denied: Cannot access ticket'));
    await expect(cancelScheduledComment('comment-1')).rejects.toThrow(unauthorized);
    expect(mocks.authorizeTicketRecordAccess).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'ticket-1', action: 'update' }));
    expect(mocks.writes).toEqual([]);
    expect(mocks.withdrawCommentAttachments).not.toHaveBeenCalled();
    expect(mocks.cancelScheduledJob).not.toHaveBeenCalled();
  });

  it('allows a non-author with ticket:update and current record access', async () => {
    await expect(cancelScheduledComment('comment-1')).resolves.toBeUndefined();
    expect(mocks.authorizeTicketRecordAccess).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'ticket-1', action: 'update' }));
    expect(mocks.writes).toContainEqual(expect.objectContaining({ table: 'comments', values: expect.objectContaining({ publish_state: 'canceled' }) }));
    expect(mocks.withdrawCommentAttachments).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'comment-1');
    expect(mocks.cancelScheduledJob).toHaveBeenCalledWith('job-1', 'tenant-1');
  });

  it('reschedule denies even the author when ticket:update is absent', async () => {
    mocks.comment = scheduledComment('internal-user');
    mocks.hasPermission.mockResolvedValue(false);
    await expect(rescheduleScheduledComment('comment-1', '2030-01-01T00:00:00.000Z', 'UTC')).rejects.toThrow(unauthorized);
    expect(mocks.authorizeTicketRecordAccess).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([]);
    expect(mocks.scheduleJobAt).not.toHaveBeenCalled();
    expect(mocks.cancelScheduledJob).not.toHaveBeenCalled();
  });

  it('reschedule denies an authorized role without current parent-ticket access', async () => {
    mocks.authorizeTicketRecordAccess.mockRejectedValue(new Error('Permission denied: Cannot access ticket'));
    await expect(rescheduleScheduledComment('comment-1', '2030-01-01T00:00:00.000Z', 'UTC')).rejects.toThrow(unauthorized);
    expect(mocks.authorizeTicketRecordAccess).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'ticket-1', action: 'update' }));
    expect(mocks.writes).toEqual([]);
    expect(mocks.scheduleJobAt).not.toHaveBeenCalled();
    expect(mocks.cancelScheduledJob).not.toHaveBeenCalled();
  });

  it('allows a non-author to reschedule with ticket:update and current record access', async () => {
    await expect(rescheduleScheduledComment('comment-1', '2030-01-01T00:00:00.000Z', 'UTC')).resolves.toBeUndefined();
    expect(mocks.authorizeTicketRecordAccess).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'ticket-1', action: 'update' }));
    expect(mocks.cancelScheduledJob).toHaveBeenCalledWith('job-1', 'tenant-1');
    expect(mocks.scheduleJobAt).toHaveBeenCalledTimes(1);
    expect(mocks.writes).toContainEqual(expect.objectContaining({ table: 'comments', values: expect.objectContaining({ scheduled_publish_tz: 'UTC' }) }));
  });
});
