// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { user_id: 'u1', user_type: 'internal' } as any,
  hasPermission: vi.fn(),
  authorize: vi.fn(),
  getAll: vi.fn(),
  get: vi.fn(),
  threads: [] as any[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.user, { tenant: 't1' }, ...args),
  hasPermission: h.hasPermission,
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: any, fn: any) => fn({}),
  registerAfterCommit: vi.fn(),
  tenantDb: () => ({
    table: () => {
      const chain: any = { select: () => chain, whereIn: () => Promise.resolve(h.threads) };
      return chain;
    },
  }),
}));
vi.mock('../../lib/ticketRecordAuthorization', () => ({ authorizeTicketRecordAccess: h.authorize }));
vi.mock('../../models/comment', () => ({ default: { getAllbyTicketId: h.getAll, get: h.get } }));
// Heavy transitive imports irrelevant to the read path.
vi.mock('@alga-psa/shared/lib/ticketCommentAttachments', () => ({ persistCommentPublication: vi.fn() }));
vi.mock('@shared/lib/ticketCommentAttachments', () => ({ withdrawCommentAttachments: vi.fn() }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({ convertBlockNoteToMarkdown: vi.fn() }));
vi.mock('@alga-psa/db/commentEventRegistry', () => ({ publishCommentEvent: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishStoredWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads', () => ({ buildTicketCommentAddedPayload: vi.fn() }));
vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({ maybeReopenBundleMasterFromChildReply: vi.fn() }));
vi.mock('../../lib/workflowTicketCommunicationEvents', () => ({}));
vi.mock('@alga-psa/shared/lib/tickets/responseState', () => ({}));
vi.mock('../../lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn() }));
vi.mock('../../lib/cannedResponses/commentMerge', () => ({ resolveCommentMergeTokens: vi.fn() }));
vi.mock('@alga-psa/shared/lib/ticketActivity', () => ({ TICKET_ACTIVITY_ACTOR: {}, TICKET_ACTIVITY_ENTITY: {}, TICKET_ACTIVITY_EVENT: {}, TICKET_ACTIVITY_SOURCE: {}, writeTicketActivity: vi.fn() }));
vi.mock('@alga-psa/core', () => ({ scheduleJobAt: vi.fn(), cancelScheduledJob: vi.fn() }));

import { findCommentById, findCommentsByTicketId } from './commentActions';

const row = (o: any = {}) => ({
  comment_id: 'c', ticket_id: 'tk', thread_id: 'th', author_type: 'internal',
  is_internal: false, publish_state: 'published', deleted_at: null, ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.user = { user_id: 'u1', user_type: 'internal' };
  h.hasPermission.mockResolvedValue(true);
  h.authorize.mockResolvedValue({});
  h.threads = [];
});

describe('findCommentsByTicketId authorization', () => {
  it('denies an internal user without ticket:read', async () => {
    h.hasPermission.mockResolvedValue(false);
    const res: any = await findCommentsByTicketId('tk');
    expect(res.actionError).toMatch(/not found/i);
    expect(h.getAll).not.toHaveBeenCalled();
  });

  it('client denied by kernel gets the same outcome as a nonexistent ticket', async () => {
    h.user = { user_id: 'c1', user_type: 'client' };
    h.authorize.mockRejectedValueOnce(new Error('Permission denied: Cannot access ticket'));
    const denied = await findCommentsByTicketId('other');
    h.authorize.mockRejectedValueOnce(new Error('Ticket not found'));
    const missing = await findCommentsByTicketId('nope');
    expect(denied).toEqual(missing);
    expect(h.getAll).not.toHaveBeenCalled();
  });

  it('MSP user gets full rows', async () => {
    const rows = [row({ comment_id: 'a', is_internal: true }), row({ comment_id: 'b', publish_state: 'scheduled' })];
    h.getAll.mockResolvedValue(rows);
    expect(await findCommentsByTicketId('tk')).toEqual(rows);
    expect(h.authorize).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'tk', action: 'read' }));
  });
});

describe('client projection', () => {
  it('returns only public, published, non-deleted comments with Bcc/internal metadata stripped', async () => {
    h.user = { user_id: 'c1', user_type: 'client' };
    h.threads = [{ thread_id: 'th-int', is_internal: true }];
    h.getAll.mockResolvedValue([
      row({ comment_id: 'ok', metadata: { email: { provider: 'google' }, email_recipients: { cc: [], bcc: [{ email: 's@x' }] } }, schedule_job_id: 'j' }),
      row({ comment_id: 'int', is_internal: true }),
      row({ comment_id: 'sched', publish_state: 'scheduled' }),
      row({ comment_id: 'del', deleted_at: '2026-01-01' }),
      row({ comment_id: 'thr', thread_id: 'th-int' }),
    ]);
    const res: any = await findCommentsByTicketId('tk');
    expect(res.map((c: any) => c.comment_id)).toEqual(['ok']);
    expect(res[0].metadata.email_recipients.bcc).toEqual([]);
    expect(res[0].metadata.email).toBeUndefined();
    expect(res[0].schedule_job_id).toBeUndefined();
  });

  it('findCommentById hides comments in internal threads from clients', async () => {
    h.user = { user_id: 'c1', user_type: 'client' };
    h.threads = [{ thread_id: 'th', is_internal: true }];
    h.get.mockResolvedValue(row());
    expect(await findCommentById('c')).toMatchObject({ actionError: expect.stringMatching(/not found/i) });
  });
});

describe('findCommentById authorization', () => {
  it('authorizes via the parent ticket', async () => {
    h.get.mockResolvedValue(row({ ticket_id: 'parent' }));
    await findCommentById('c');
    expect(h.authorize).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'parent', action: 'read' }));
  });

  it('missing comment, forbidden comment and hidden comment look identical to a client', async () => {
    h.user = { user_id: 'c1', user_type: 'client' };
    h.get.mockResolvedValueOnce(undefined);
    const missing = await findCommentById('x');
    h.get.mockResolvedValueOnce(row());
    h.authorize.mockRejectedValueOnce(new Error('Permission denied: Cannot access ticket'));
    const forbidden = await findCommentById('x');
    h.get.mockResolvedValueOnce(row({ is_internal: true }));
    const hidden = await findCommentById('x');
    expect(missing).toMatchObject({ actionError: expect.stringMatching(/not found/i) });
    expect(forbidden).toEqual(missing);
    expect(hidden).toEqual(missing);
  });
});
