import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelayedEmailQueue, type RedisClientLike } from '../../../../packages/email/src/DelayedEmailQueue';

function makeRedis(overrides: Partial<RedisClientLike>): RedisClientLike {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(0),
    zAdd: vi.fn().mockResolvedValue(0),
    zRem: vi.fn().mockResolvedValue(0),
    zRangeByScore: vi.fn().mockResolvedValue([]),
    zCard: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('DelayedEmailQueue Redis recovery', () => {
  afterEach(async () => {
    try {
      await DelayedEmailQueue.getInstance().shutdown();
    } catch {
      // ignore
    }
    DelayedEmailQueue.resetInstance();
    vi.useRealTimers();
  });

  it('recreates the Redis client after a zRangeByScore timeout', async () => {
    vi.useFakeTimers();

    const hangingRedis = makeRedis({
      zRangeByScore: vi.fn(() => new Promise<string[]>(() => {})),
    });

    const workingRedis = makeRedis({
      zRangeByScore: vi.fn().mockResolvedValue([]),
    });

    const redisGetter = vi
      .fn()
      .mockResolvedValueOnce(hangingRedis)
      .mockResolvedValueOnce(workingRedis);

    const queue = DelayedEmailQueue.getInstance({
      checkIntervalMs: 60_000,
      redisTimeoutMs: 10,
      batchSize: 10,
    });

    await queue.initialize(redisGetter, vi.fn().mockResolvedValue(undefined));

    const resultPromise = queue.processReady();
    await vi.advanceTimersByTimeAsync(20);
    await expect(resultPromise).resolves.toBe(0);

    expect(redisGetter).toHaveBeenCalledTimes(2);
    expect(hangingRedis.zRangeByScore).toHaveBeenCalledTimes(1);
    expect(workingRedis.zRangeByScore).toHaveBeenCalledTimes(1);
  });
});

