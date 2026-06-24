import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  publishWorkflowEvent: vi.fn(),
  registerAfterCommit: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: mocks.publishWorkflowEvent,
}));

vi.mock('@alga-psa/db', () => ({
  registerAfterCommit: mocks.registerAfterCommit,
}));

import { TicketModelEventPublisher } from './TicketModelEventPublisher';

describe('TicketModelEventPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('swallows immediate publish failures after ticket creation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.publishWorkflowEvent.mockRejectedValueOnce(new Error('event bus down'));

    await expect(
      new TicketModelEventPublisher().publishTicketCreated({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        metadata: { source: 'ninjaone' },
      }),
    ).resolves.toBeUndefined();

    expect(mocks.publishWorkflowEvent).toHaveBeenCalledWith({
      eventType: 'TICKET_CREATED',
      payload: {
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        userId: undefined,
        source: 'ninjaone',
      },
      ctx: {
        tenantId: 'tenant-1',
        actor: { actorType: 'SYSTEM' },
      },
    });
    expect(consoleError).toHaveBeenCalledWith('Failed to publish TICKET_CREATED event:', expect.any(Error));
    consoleError.mockRestore();
  });

  it('registers TICKET_CREATED as an after-commit hook when constructed with a transaction', async () => {
    const trx = {} as any;

    await new TicketModelEventPublisher(trx).publishTicketCreated({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      metadata: { source: 'huntress' },
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
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        userId: undefined,
        source: 'huntress',
      },
      ctx: {
        tenantId: 'tenant-1',
        actor: { actorType: 'SYSTEM' },
      },
    });
  });
});
