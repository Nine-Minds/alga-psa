import { describe, expect, it, vi, beforeEach } from 'vitest';

const publishEventMock = vi.fn(async () => 'msg-1');
const initializeMock = vi.fn(async () => undefined);

vi.mock('./redisStreamClient', () => ({
  RedisStreamClient: class {
    initialize = initializeMock;
    publishEvent = publishEventMock;
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'uuid-1'),
}));

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('publishEvent', () => {
  beforeEach(() => {
    publishEventMock.mockClear();
    initializeMock.mockClear();
  });

  it('publishes a workflow event to the Redis stream client', async () => {
    const { publishEvent } = await import('./publisher');

    const messageId = await publishEvent({
      eventType: 'ticket.created',
      tenant: 'tenant-1',
      payload: { id: 123 },
      correlationId: 'corr-1',
    });

    expect(messageId).toBe('msg-1');
    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(publishEventMock).toHaveBeenCalledTimes(1);

    const [workflowEvent] = publishEventMock.mock.calls[0];
    expect(workflowEvent).toMatchObject({
      event_id: 'uuid-1',
      execution_id: 'corr-1',
      event_name: 'ticket.created',
      event_type: 'ticket.created',
      tenant: 'tenant-1',
      payload: { id: 123 },
    });
    expect(typeof workflowEvent.timestamp).toBe('string');
  });
});
