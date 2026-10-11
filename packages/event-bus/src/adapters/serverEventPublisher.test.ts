import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  publishWorkflowEvent: vi.fn(),
  registerAfterCommit: vi.fn(),
}));

vi.mock('../publishers', () => ({
  publishWorkflowEvent: mocks.publishWorkflowEvent,
}));

vi.mock('@alga-psa/db', () => ({
  registerAfterCommit: mocks.registerAfterCommit,
}));

import { ServerEventPublisher } from './serverEventPublisher';

describe('ServerEventPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishWorkflowEvent.mockResolvedValue(undefined);
  });

  it('publishes immediately when no transaction is supplied', async () => {
    await new ServerEventPublisher().publishTicketCreated({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      userId: 'user-1',
    });

    expect(mocks.registerAfterCommit).not.toHaveBeenCalled();
    expect(mocks.publishWorkflowEvent).toHaveBeenCalledTimes(1);
  });

  it('defers TICKET_CREATED until the creating transaction commits', async () => {
    const trx = {} as any;

    await new ServerEventPublisher(trx).publishTicketCreated({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      userId: 'user-1',
      metadata: { source: 'client_portal' },
    });

    expect(mocks.publishWorkflowEvent).not.toHaveBeenCalled();
    expect(mocks.registerAfterCommit).toHaveBeenCalledWith(
      trx,
      expect.any(Function),
      'TICKET_CREATED ticket=ticket-1',
    );

    const hook = mocks.registerAfterCommit.mock.calls[0][1] as () => Promise<void>;
    await hook();

    expect(mocks.publishWorkflowEvent).toHaveBeenCalledWith({
      eventType: 'TICKET_CREATED',
      payload: {
        ticketId: 'ticket-1',
        createdByUserId: 'user-1',
        createdAt: expect.any(String),
        source: 'client_portal',
      },
      ctx: {
        tenantId: 'tenant-1',
        actor: { actorType: 'USER', actorUserId: 'user-1' },
      },
    });
  });
});
