import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coManagedWorkflowTicketSeam } from '../../../../../lib/coManagedDelivery';

type RegisteredAction = { id: string; inputSchema: { parse: (value: unknown) => any }; handler: (input: any, ctx: any) => Promise<any> };
const registered: RegisteredAction[] = [];
const { servesMock, createCommentMock } = vi.hoisted(() => ({
  servesMock: vi.fn(async (..._args: unknown[]) => ({ served: true, reasons: { served: 'open' } })),
  createCommentMock: vi.fn()
}));

vi.mock('@alga-psa/core/capability', () => ({ serves: (...args: unknown[]) => servesMock(...args) }));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('../../../../../models/ticketModel', () => ({ TicketModel: { createComment: (...args: unknown[]) => createCommentMock(...args) } }));
vi.mock('../../../registries/actionRegistry', () => ({
  getActionRegistryV2: () => ({ register: (action: RegisteredAction) => registered.push(action) })
}));
vi.mock('../shared', async () => {
  const actual = await vi.importActual<typeof import('../shared')>('../shared');
  const tx = { tenantId: 'tenant-1', trx: { marker: 'transaction' }, actorUserId: '91a53464-0b67-4e3f-ae88-922d9c5af6ed' };
  return {
    ...actual,
    withTenantTransaction: async (_ctx: unknown, fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
    requirePermission: vi.fn(async () => undefined),
    writeRunAudit: vi.fn(async () => undefined)
  };
});

const ctx = { tenantId: 'tenant-1', runId: 'run-1', stepPath: 'root.comment' };

async function getAddCommentAction() {
  registered.length = 0;
  const { registerTicketActions } = await import('../tickets');
  registerTicketActions();
  const action = registered.find(({ id }) => id === 'tickets.add_comment');
  expect(action).toBeDefined();
  return action!;
}

describe('tickets.add_comment co-managed authority', () => {
  beforeEach(() => {
    coManagedWorkflowTicketSeam.reset();
    servesMock.mockReset().mockResolvedValue({ served: true, reasons: { served: 'open' } } as any);
    createCommentMock.mockReset().mockResolvedValue({ comment_id: 'comment-1', created_at: new Date().toISOString() });
  });

  it('does not create a comment when the registered record authority denies scope', async () => {
    coManagedWorkflowTicketSeam.register(() => ({ retain: async () => { throw Object.assign(new Error('scope denied'), { code: 'SCOPE_DENIED' }); } }));
    const action = await getAddCommentAction();

    await expect(action.handler(action.inputSchema.parse({ ticket_id: 'd410d992-4e99-43e7-9390-f6b0ff744509', body: 'hello', visibility: 'public' }), ctx))
      .rejects.toThrow('scope denied');
    expect(createCommentMock).not.toHaveBeenCalled();
  });

  it('does not create a comment when a served tenant has no registered authority', async () => {
    const action = await getAddCommentAction();

    await expect(action.handler(action.inputSchema.parse({ ticket_id: 'd410d992-4e99-43e7-9390-f6b0ff744509', body: 'hello', visibility: 'public' }), ctx))
      .rejects.toMatchObject({ code: 'WORKFLOW_TICKET_AUTHORITY_UNAVAILABLE' });
    expect(createCommentMock).not.toHaveBeenCalled();
  });

  it('creates an in-scope comment after the authority retains the requested field', async () => {
    const retain = vi.fn(async () => undefined);
    coManagedWorkflowTicketSeam.register(() => ({ retain }));
    const action = await getAddCommentAction();

    await action.handler(action.inputSchema.parse({ ticket_id: 'd410d992-4e99-43e7-9390-f6b0ff744509', body: 'hello', visibility: 'public' }), ctx);
    expect(retain).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ fields: ['comments'], ticketId: 'd410d992-4e99-43e7-9390-f6b0ff744509' }));
    expect(createCommentMock).toHaveBeenCalledOnce();
  });
});
