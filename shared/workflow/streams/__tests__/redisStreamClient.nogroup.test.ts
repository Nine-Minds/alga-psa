import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));
const fakeClient = vi.hoisted(() => ({ current: null as any }));

vi.mock('@alga-psa/core/logger', () => ({ default: loggerMock }));
vi.mock('../../../core/getSecret', () => ({ getSecret: vi.fn(async () => 'pw') }));
vi.mock('redis', () => ({ createClient: () => fakeClient.current }));

const NOGROUP = (stream: string) =>
  `NOGROUP No such key '${stream}' or consumer group 'workflow-processors' in XREADGROUP with GROUP option`;

function makeClient() {
  const client: any = new EventEmitter();
  client.connect = vi.fn(async () => undefined);
  client.quit = vi.fn(async () => undefined);
  client.xGroupCreate = vi.fn(async () => 'OK');
  client.xReadGroup = vi.fn(async () => null);
  client.xPending = vi.fn(async () => ({ pending: 0 }));
  client.xAutoClaim = vi.fn(async () => ({ messages: [] }));
  return client;
}

describe('RedisStreamClient NOGROUP self-heal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeClient.current = makeClient();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('recreates the group after XPENDING reports NOGROUP and then delivers messages', async () => {
    const { RedisStreamClient } = await import('../redisStreamClient');
    const client = fakeClient.current;
    const streamClient = new RedisStreamClient();

    let pendingCalls = 0;
    client.xPending = vi.fn(async (stream: string) => {
      pendingCalls += 1;
      if (pendingCalls === 1) throw new Error(NOGROUP(stream));
      return { pending: 0 };
    });
    client.xReadGroup = vi.fn(async (_g: string, _c: string, streams: Array<{ key: string }>) => [
      { name: streams[0].key, messages: [{ id: '1-0', message: { event: '{}' } }] },
    ]);

    // First tick: group was ensured (cached), XPENDING fails with NOGROUP -> empty result, no throw.
    await expect(streamClient.readGroupMessages('exec-1')).resolves.toEqual([]);
    const createsAfterFirst = client.xGroupCreate.mock.calls.length;
    expect(createsAfterFirst).toBe(1);

    // Second tick: cache was invalidated, so the group is recreated at '0' and the message is delivered.
    const messages = await streamClient.readGroupMessages('exec-1');
    expect(client.xGroupCreate.mock.calls.length).toBe(createsAfterFirst + 1);
    expect(client.xGroupCreate.mock.calls[1][2]).toBe('0');
    expect(client.xGroupCreate.mock.calls[1][3]).toEqual({ MKSTREAM: true });
    expect(messages).toEqual([{ id: '1-0', message: { event: '{}' } }]);

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(
      loggerMock.warn.mock.calls.filter((c) => String(c[0]).includes('consumer group missing'))
    ).toHaveLength(1);

    await streamClient.close();
  });

  it('warns once per streak and heals the claim path', async () => {
    const { RedisStreamClient } = await import('../redisStreamClient');
    const client = fakeClient.current;
    const streamClient = new RedisStreamClient();

    client.xPending = vi.fn(async (stream: string) => {
      throw new Error(NOGROUP(stream));
    });

    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await expect(streamClient.readGroupMessages('exec-2')).resolves.toEqual([]);
    }
    await expect(streamClient.claimPendingMessages('exec-2')).resolves.toEqual([]);

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(
      loggerMock.warn.mock.calls.filter((c) => String(c[0]).includes('consumer group missing'))
    ).toHaveLength(1);
    // Every NOGROUP invalidated the cache, so each tick re-ran XGROUP CREATE.
    expect(client.xGroupCreate.mock.calls.length).toBe(5);

    await streamClient.close();
  });
});
