import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behaviour of the `tickets.add_comment` handler around one-off Cc/Bcc: what
 * it stores and, above all, whether it hands TicketModel.createComment an
 * event publisher — that argument is what turns a silent workflow comment into
 * a TICKET_COMMENT_ADDED event and so into email. The delivery half is pinned
 * by server/src/test/integration/ticketCommentEmailRecipientsSmtp.test.ts.
 */
const createCommentMock = vi.fn(async () => ({
  comment_id: '22222222-2222-4222-8222-222222222222',
  created_at: '2026-10-06T12:00:00.000Z',
}));

vi.mock('../../../../models/ticketModel', () => ({
  TicketModel: { createComment: createCommentMock },
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();
  return {
    ...actual,
    withTenantTransaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ tenantId: 'tenant-1', actorUserId: 'actor-1', trx: {} }),
    requirePermission: async () => undefined,
    writeRunAudit: async () => undefined,
    attachDocumentToTicket: async () => undefined,
  };
});

const TICKET_ID = '11111111-1111-4111-8111-111111111111';

async function addCommentAction() {
  const { getActionRegistryV2 } = await import('../../registries/actionRegistry');
  const { registerTicketActions } = await import('../businessOperations/tickets');
  if (!getActionRegistryV2().get('tickets.add_comment', 1)) {
    registerTicketActions();
  }
  const action = getActionRegistryV2().get('tickets.add_comment', 1);
  if (!action) {
    throw new Error('Expected tickets.add_comment to be registered');
  }
  return action;
}

const ctx = { tenantId: 'tenant-1', runId: 'run-1', stepPath: 'step-1' } as never;

describe('tickets.add_comment one-off recipients', () => {
  beforeEach(() => {
    createCommentMock.mockClear();
  });

  it('T043: cc on an internal comment fails validation and writes no comment', async () => {
    const action = await addCommentAction();

    await expect(action.handler({
      ticket_id: TICKET_ID,
      body: 'Internal only',
      visibility: 'internal',
      cc: [{ email: 'vendor@acme.com' }],
    }, ctx)).rejects.toMatchObject({
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
    });

    expect(createCommentMock).not.toHaveBeenCalled();
  });

  it('T044: cc/bcc are stored and the comment publishes TICKET_COMMENT_ADDED', async () => {
    const action = await addCommentAction();

    await action.handler({
      ticket_id: TICKET_ID,
      body: 'Looping in the vendor',
      visibility: 'public',
      cc: [{ email: 'vendor@acme.com', name: 'Vendor' }],
      bcc: [{ email: 'boss@msp.test' }],
    }, ctx);

    expect(createCommentMock).toHaveBeenCalledTimes(1);
    const [input, tenantId, , eventPublisher] = createCommentMock.mock.calls[0] as unknown[] as [
      Record<string, unknown>, string, unknown, unknown,
    ];
    expect(tenantId).toBe('tenant-1');
    expect(input.emailRecipients).toEqual({ cc: ['vendor@acme.com'], bcc: ['boss@msp.test'] });
    // A publisher is what makes createComment persist the publication intent.
    expect(eventPublisher).toBeDefined();
  });

  it('T045: without cc/bcc the comment stays silent, exactly as before', async () => {
    const action = await addCommentAction();

    await action.handler({
      ticket_id: TICKET_ID,
      body: 'Just a note on the run',
      visibility: 'public',
    }, ctx);

    expect(createCommentMock).toHaveBeenCalledTimes(1);
    const [input, , , eventPublisher] = createCommentMock.mock.calls[0] as unknown[] as [
      Record<string, unknown>, string, unknown, unknown,
    ];
    expect(input).not.toHaveProperty('emailRecipients');
    expect(eventPublisher).toBeUndefined();
  });
});
