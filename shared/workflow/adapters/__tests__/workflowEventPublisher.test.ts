import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishEventMock = vi.fn();
const registerAfterCommitMock = vi.fn();

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  registerAfterCommit: (...args: any[]) => registerAfterCommitMock(...args),
}));

describe('WorkflowEventPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishEventMock.mockResolvedValue(undefined);
  });

  it('defers ticket-created publication until the creating transaction commits', async () => {
    const { WorkflowEventPublisher } = await import('../workflowEventPublisher');
    const trx = {} as any;
    const publisher = new WorkflowEventPublisher({ transaction: trx });

    await publisher.publishTicketCreated({
      tenantId: '91a53464-0b67-4e3f-ae88-922d9c5af6ed',
      ticketId: '7fa265ac-3a50-4ad6-9454-4a860d884996',
      metadata: { source: 'email' },
    });

    expect(publishEventMock).not.toHaveBeenCalled();
    expect(registerAfterCommitMock).toHaveBeenCalledWith(
      trx,
      expect.any(Function),
      'TICKET_CREATED ticket=7fa265ac-3a50-4ad6-9454-4a860d884996',
    );

    const hook = registerAfterCommitMock.mock.calls[0][1] as () => Promise<void>;
    await hook();

    expect(publishEventMock).toHaveBeenCalledTimes(1);
  });

  it('publishes ticket-created events through the configured event bus fanout', async () => {
    const { WorkflowEventPublisher } = await import('../workflowEventPublisher');
    const publisher = new WorkflowEventPublisher();

    await publisher.publishTicketCreated({
      tenantId: '91a53464-0b67-4e3f-ae88-922d9c5af6ed',
      ticketId: '7fa265ac-3a50-4ad6-9454-4a860d884996',
      metadata: {
        source: 'email',
        board_id: 'd7853ff0-f826-43a4-a032-f5056b2c0202',
      },
    });

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    expect(publishEventMock).toHaveBeenCalledWith({
      eventType: 'TICKET_CREATED',
      payload: {
        tenantId: '91a53464-0b67-4e3f-ae88-922d9c5af6ed',
        ticketId: '7fa265ac-3a50-4ad6-9454-4a860d884996',
        userId: '7fa265ac-3a50-4ad6-9454-4a860d884996',
        source: 'email',
        board_id: 'd7853ff0-f826-43a4-a032-f5056b2c0202',
      },
    }, undefined);
  });

  it('publishes inbound-created comment notifications through the event-bus fanout (internal + email)', async () => {
    const { WorkflowEventPublisher } = await import('../workflowEventPublisher');
    const publisher = new WorkflowEventPublisher();

    await publisher.publishCommentCreated({
      tenantId: '91a53464-0b67-4e3f-ae88-922d9c5af6ed',
      ticketId: '7fa265ac-3a50-4ad6-9454-4a860d884996',
      commentId: 'd4c6bbe0-2d3d-4a27-af98-643070961eaa',
      metadata: {
        isInternal: false,
        content: 'Customer reply body',
        author: 'Jane Client',
      },
    });

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    expect(publishEventMock).toHaveBeenCalledWith({
      eventType: 'TICKET_COMMENT_ADDED',
      payload: {
        tenantId: '91a53464-0b67-4e3f-ae88-922d9c5af6ed',
        ticketId: '7fa265ac-3a50-4ad6-9454-4a860d884996',
        userId: '7fa265ac-3a50-4ad6-9454-4a860d884996',
        comment: {
          id: 'd4c6bbe0-2d3d-4a27-af98-643070961eaa',
          content: 'Customer reply body',
          author: 'Jane Client',
          isInternal: false,
        },
      },
    }, undefined);
  });

  it('keeps the new-ticket first comment on the internal-notifications channel only', async () => {
    const { WorkflowEventPublisher } = await import('../workflowEventPublisher');
    const publisher = new WorkflowEventPublisher({ suppressCommentEmail: true });

    await publisher.publishCommentCreated({
      tenantId: '91a53464-0b67-4e3f-ae88-922d9c5af6ed',
      ticketId: '7fa265ac-3a50-4ad6-9454-4a860d884996',
      commentId: 'd4c6bbe0-2d3d-4a27-af98-643070961eaa',
      metadata: {
        isInternal: false,
        content: 'Original inbound email body',
        author: 'Jane Client',
      },
    });

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    expect(publishEventMock).toHaveBeenCalledWith({
      eventType: 'TICKET_COMMENT_ADDED',
      payload: {
        tenantId: '91a53464-0b67-4e3f-ae88-922d9c5af6ed',
        ticketId: '7fa265ac-3a50-4ad6-9454-4a860d884996',
        userId: '7fa265ac-3a50-4ad6-9454-4a860d884996',
        comment: {
          id: 'd4c6bbe0-2d3d-4a27-af98-643070961eaa',
          content: 'Original inbound email body',
          author: 'Jane Client',
          isInternal: false,
        },
      },
    }, { channel: 'internal-notifications' });
  });
});
