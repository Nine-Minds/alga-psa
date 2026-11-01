import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeCoManagedVerdict } from './helpers/nativeCoManagedVerdict';

/**
 * CM L5 guard (DO-NOT-PORT #2): a workflow `tickets.add_comment` without Cc/Bcc must not
 * publish TICKET_COMMENT_ADDED. Publication is gated solely on handing TicketModel.createComment
 * an event publisher; with none, nothing is persisted or dispatched.
 */
const createCommentMock = vi.fn(async (..._args: unknown[]) => ({
  comment_id: '22222222-2222-4222-8222-222222222222',
  created_at: '2026-10-06T12:00:00.000Z',
}));
const publishEventMock = vi.fn(async () => undefined);

vi.mock('../../../../models/ticketModel', () => ({ TicketModel: { createComment: createCommentMock } }));
vi.mock('../../../adapters/workflowEventPublisher', () => ({
  WorkflowEventPublisher: class { publish = publishEventMock; publishTicketCommentAdded = publishEventMock; },
}));
vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();
  return {
    ...actual,
    withTenantTransaction: async (_c: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ tenantId: 'tenant-1', actorUserId: 'actor-1', trx: {} }),
    requirePermission: async () => undefined,
    writeRunAudit: async () => undefined,
    attachDocumentToTicket: async () => undefined,
  };
});

describe('workflow tickets.add_comment does not publish TICKET_COMMENT_ADDED', () => {
  useNativeCoManagedVerdict();
  beforeEach(() => { createCommentMock.mockClear(); publishEventMock.mockClear(); });

  it('passes no event publisher for public and internal comments without Cc/Bcc', async () => {
    const { getActionRegistryV2 } = await import('../../registries/actionRegistry');
    const { registerTicketActions } = await import('../businessOperations/tickets');
    if (!getActionRegistryV2().get('tickets.add_comment', 1)) registerTicketActions();
    const action = getActionRegistryV2().get('tickets.add_comment', 1)!;
    const ctx = { tenantId: 'tenant-1', runId: 'run-1', stepPath: 'step-1' } as never;
    const ticket_id = '11111111-1111-4111-8111-111111111111';

    for (const visibility of ['public', 'internal'] as const) {
      await action.handler({ ticket_id, body: 'note', visibility }, ctx);
    }

    expect(createCommentMock).toHaveBeenCalledTimes(2);
    for (const call of createCommentMock.mock.calls) expect(call[3]).toBeUndefined();
    expect(publishEventMock).not.toHaveBeenCalled();
  });
});
