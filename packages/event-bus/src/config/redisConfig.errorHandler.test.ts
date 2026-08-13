import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async () => null),
}));

const mockOn = vi.fn();
const mockConnect = vi.fn(async () => undefined);

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    on: mockOn,
    connect: mockConnect,
  })),
}));

describe('event-bus redisConfig.getRedisClient', () => {
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('attaches an error handler to prevent uncaughtException on socket close', async () => {
    vi.stubEnv('REDIS_HOST', 'redis.msp.svc.cluster.local');
    vi.stubEnv('REDIS_PORT', '6379');

    const { getRedisClient } = await import('./redisConfig');
    await getRedisClient();

    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});

