import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RedisEntry = { value: string; score: number };

function createRedisMock() {
  const values = new Map<string, string>();
  const sortedSets = new Map<string, RedisEntry[]>();

  return {
    values,
    sortedSets,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return 'OK';
    }),
    zAdd: vi.fn(async (key: string, entry: RedisEntry) => {
      const entries = sortedSets.get(key) ?? [];
      const next = entries.filter((existing) => existing.value !== entry.value);
      next.push(entry);
      sortedSets.set(key, next);
      return 1;
    }),
    zRangeWithScores: vi.fn(async (key: string) => {
      return [...(sortedSets.get(key) ?? [])].sort((a, b) => a.score - b.score).slice(0, 1);
    }),
    zRangeByScoreWithScores: vi.fn(async (key: string, min: number, max: number) => {
      return [...(sortedSets.get(key) ?? [])]
        .filter((entry) => entry.score >= min && entry.score <= max)
        .sort((a, b) => a.score - b.score)
        .slice(0, 1);
    }),
    zRem: vi.fn(async (key: string, value: string) => {
      const entries = sortedSets.get(key) ?? [];
      const next = entries.filter((entry) => entry.value !== value);
      sortedSets.set(key, next);
      return entries.length === next.length ? 0 : 1;
    }),
    del: vi.fn(async (key: string) => {
      values.delete(key);
      return 1;
    }),
    zCard: vi.fn(async (key: string) => sortedSets.get(key)?.length ?? 0),
    zRange: vi.fn(async (key: string) =>
      [...(sortedSets.get(key) ?? [])].sort((a, b) => a.score - b.score).map((entry) => entry.value)
    ),
    zScore: vi.fn(async (key: string, value: string) => {
      const entry = (sortedSets.get(key) ?? []).find((candidate) => candidate.value === value);
      return entry?.score ?? null;
    }),
    quit: vi.fn(async () => undefined),
  };
}

const redisMock = createRedisMock();

vi.mock('../../../config/redisConfig', () => ({
  getRedisClient: vi.fn(async () => redisMock),
  getRedisConfig: vi.fn(() => ({ prefix: 'alga-psa:' })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('NotificationAccumulator suppression flags', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    redisMock.values.clear();
    redisMock.sortedSets.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { NotificationAccumulator } = await import('../NotificationAccumulator');
    await NotificationAccumulator.getInstance().shutdown();
    vi.useRealTimers();
  });

  it('preserves suppression flags in accumulated payloads without adding them to the dedupe key', async () => {
    const { NotificationAccumulator } = await import('../NotificationAccumulator');
    const flushedNotifications: unknown[] = [];
    const accumulator = NotificationAccumulator.getInstance({
      accumulationWindowMs: 30_000,
      flushIntervalMs: 5_000,
    });

    await accumulator.initialize(async (notification) => {
      flushedNotifications.push(notification);
    });

    await accumulator.accumulate({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      eventType: 'TICKET_UPDATED',
      userId: 'user-1',
      payload: {
        ticketId: 'ticket-1',
        suppressContactNotifications: true,
        suppressInternalNotifications: false,
      },
    });
    await accumulator.accumulate({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      eventType: 'TICKET_UPDATED',
      userId: 'user-2',
      payload: {
        ticketId: 'ticket-1',
        suppressContactNotifications: true,
        suppressInternalNotifications: true,
      },
    });

    expect([...redisMock.values.keys()]).toEqual([
      'alga-psa:emailservice::accumulator::v2:notification:pending:tenant-1:ticket-1:TICKET_UPDATED',
    ]);

    await accumulator.flushAll();

    expect(flushedNotifications).toHaveLength(1);
    expect(flushedNotifications[0]).toEqual(
      expect.objectContaining({
        accumulatedEvents: [
          expect.objectContaining({
            payload: expect.objectContaining({
              suppressContactNotifications: true,
              suppressInternalNotifications: false,
            }),
          }),
          expect.objectContaining({
            payload: expect.objectContaining({
              suppressContactNotifications: true,
              suppressInternalNotifications: true,
            }),
          }),
        ],
      })
    );
  });
});
