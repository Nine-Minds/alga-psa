import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

type XAddCall = {
  stream: string;
  fields: Record<string, string>;
};

const redisState = vi.hoisted(() => ({
  xAddCalls: [] as XAddCall[],
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('redis', () => ({
  createClient: () => {
    const client = new EventEmitter() as EventEmitter & {
      connect: () => Promise<void>;
      disconnect: () => void;
      quit: () => Promise<void>;
      xGroupCreate: () => Promise<void>;
      xAdd: (stream: string, id: string, fields: Record<string, string>) => Promise<string>;
    };

    client.connect = vi.fn(async () => {
      client.emit('connect');
      client.emit('ready');
    });
    client.disconnect = vi.fn(() => {
      client.emit('end');
    });
    client.quit = vi.fn(async () => {
      client.emit('end');
    });
    client.xGroupCreate = vi.fn(async () => undefined);
    client.xAdd = vi.fn(async (stream: string, _id: string, fields: Record<string, string>) => {
      redisState.xAddCalls.push({ stream, fields });
      return `${redisState.xAddCalls.length}-0`;
    });

    return client;
  },
}));

describe('EventBus workflow payload suppression flags', () => {
  afterEach(() => {
    redisState.xAddCalls.length = 0;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('writes suppression flags into the default-channel workflow stream payload_json', async () => {
    const { getEventBus } = await import('./index');
    const eventBus = getEventBus();

    await eventBus.publish({
      eventType: 'TICKET_UPDATED',
      payload: {
        tenantId: 'tenant-1',
        occurredAt: '2026-07-09T12:00:00.000Z',
        ticketId: '00000000-0000-4000-8000-000000000001',
        updatedByUserId: '00000000-0000-4000-8000-000000000002',
        changes: {
          priority_id: {
            previous: 'priority-1',
            new: 'priority-2',
          },
        },
        suppressContactNotifications: true,
        suppressInternalNotifications: true,
      },
    } as any);

    const workflowPublish = redisState.xAddCalls.find((call) => call.stream === 'workflow:events:global');
    expect(workflowPublish).toBeDefined();
    expect(JSON.parse(workflowPublish?.fields.payload_json ?? '{}')).toEqual(
      expect.objectContaining({
        suppressContactNotifications: true,
        suppressInternalNotifications: true,
      })
    );

    await eventBus.close();
  });
});
