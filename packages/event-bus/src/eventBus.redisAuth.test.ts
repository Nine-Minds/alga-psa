import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSecret: vi.fn(),
}));

vi.mock('redis', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: mocks.getSecret,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('EventBus Redis authentication', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('omits the password option when no Redis password is configured', async () => {
    mocks.getSecret.mockResolvedValue('');
    mocks.createClient.mockImplementation(() => {
      const client = new EventEmitter() as EventEmitter & {
        connect: () => Promise<void>;
        quit: () => Promise<void>;
        xGroupCreate: () => Promise<void>;
      };

      client.connect = vi.fn(async () => {
        client.emit('connect');
        client.emit('ready');
      });
      client.quit = vi.fn(async () => {
        client.emit('end');
      });
      client.xGroupCreate = vi.fn(async () => undefined);
      return client;
    });

    const { getEventBus } = await import('./eventBus');
    const eventBus = getEventBus();

    await eventBus.initialize();

    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.createClient.mock.calls[0][0]).not.toHaveProperty('password');

    await eventBus.close();
  });
});
