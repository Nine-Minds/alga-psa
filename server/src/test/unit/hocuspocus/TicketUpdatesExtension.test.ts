import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.fn();

vi.mock('redis', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe('TicketUpdatesExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createSubscriberHarness() {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const pSubscribeMock = vi.fn();
    const subscriber = {
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        handlers.set(event, handler);
      }),
      connect: vi.fn(async () => {
        const readyHandler = handlers.get('ready');
        if (readyHandler) {
          await readyHandler();
        }
      }),
      pSubscribe: vi.fn(async (...args: any[]) => pSubscribeMock(...args)),
      quit: vi.fn(async () => undefined),
    };

    createClientMock.mockReturnValue(subscriber);

    return { handlers, pSubscribeMock, subscriber };
  }

  it('T018: Redis publishes are bridged into the matching ticket room as stateless broadcasts', async () => {
    const { pSubscribeMock } = createSubscriberHarness();
    const broadcastStateless = vi.fn();
    const instance = {
      documents: new Map([
        ['ticket:tenant-1:ticket-1', { broadcastStateless }],
      ]),
    };

    const { TicketUpdatesExtension } = await import('../../../../../hocuspocus/TicketUpdatesExtension.js');
    const extension = new TicketUpdatesExtension({ redisPrefix: 'alga-psa:' });
    await extension.onConfigure({ instance });

    expect(pSubscribeMock).toHaveBeenCalledWith('alga-psa:ticket-updates:*', expect.any(Function));

    const callback = pSubscribeMock.mock.calls[0][1];
    const payload = {
      updatedFields: ['status_id'],
      updatedBy: { userId: 'user-1', displayName: 'Pat Agent' },
      updatedAt: '2026-05-07T12:00:00.000Z',
    };
    await callback(JSON.stringify(payload), 'alga-psa:ticket-updates:tenant-1:ticket-1');

    expect(broadcastStateless).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  it('T019: publishes for rooms without active clients are a no-op', async () => {
    const { pSubscribeMock } = createSubscriberHarness();
    const instance = {
      documents: new Map(),
    };

    const { TicketUpdatesExtension } = await import('../../../../../hocuspocus/TicketUpdatesExtension.js');
    const extension = new TicketUpdatesExtension({ redisPrefix: 'alga-psa:' });
    await extension.onConfigure({ instance });

    const callback = pSubscribeMock.mock.calls[0][1];
    await expect(
      callback(
        JSON.stringify({
          updatedFields: ['status_id'],
          updatedBy: { userId: 'user-1', displayName: 'Pat Agent' },
          updatedAt: '2026-05-07T12:00:00.000Z',
        }),
        'alga-psa:ticket-updates:tenant-1:ticket-1'
      )
    ).resolves.toBeUndefined();
  });

  it('T020: subscriber reconnects re-establish the Redis pattern subscription', async () => {
    const { handlers, pSubscribeMock } = createSubscriberHarness();
    const instance = {
      documents: new Map(),
    };

    const { TicketUpdatesExtension } = await import('../../../../../hocuspocus/TicketUpdatesExtension.js');
    const extension = new TicketUpdatesExtension({ redisPrefix: 'alga-psa:' });
    await extension.onConfigure({ instance });

    expect(pSubscribeMock).toHaveBeenCalledTimes(1);

    const endHandler = handlers.get('end');
    const readyHandler = handlers.get('ready');
    expect(endHandler).toBeDefined();
    expect(readyHandler).toBeDefined();

    endHandler?.();
    await readyHandler?.();

    expect(pSubscribeMock).toHaveBeenCalledTimes(2);
  });
});
