/**
 * Tests for the delayed-email retry backoff calculation
 * (exponential backoff capped at 15 minutes, with ±10% jitter).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelayedEmailQueue } from '../DelayedEmailQueue';

const MINUTE = 60_000;

describe('DelayedEmailQueue.calculateDelay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('doubles the delay per retry with no jitter when Math.random is centered', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter term becomes 0

    expect(DelayedEmailQueue.calculateDelay(0)).toBe(1 * MINUTE);
    expect(DelayedEmailQueue.calculateDelay(1)).toBe(2 * MINUTE);
    expect(DelayedEmailQueue.calculateDelay(2)).toBe(4 * MINUTE);
    expect(DelayedEmailQueue.calculateDelay(3)).toBe(8 * MINUTE);
  });

  it('caps the backoff at 15 minutes', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(DelayedEmailQueue.calculateDelay(4)).toBe(15 * MINUTE); // 16min capped to 15min
    expect(DelayedEmailQueue.calculateDelay(10)).toBe(15 * MINUTE);
  });

  it('applies at most ±10% jitter around the base delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1); // max positive jitter
    expect(DelayedEmailQueue.calculateDelay(0)).toBe(Math.floor(1.1 * MINUTE));

    vi.spyOn(Math, 'random').mockReturnValue(0); // max negative jitter
    expect(DelayedEmailQueue.calculateDelay(0)).toBe(Math.floor(0.9 * MINUTE));
  });

  it('exposes the default retry ceiling', () => {
    expect(DelayedEmailQueue.MAX_RETRIES).toBe(5);
  });

  it('preserves sender routing fields in the delayed retry payload', async () => {
    const stored = new Map<string, string>();
    const redis = {
      get: async (key: string) => stored.get(key) ?? null,
      set: async (key: string, value: string) => { stored.set(key, value); },
      del: async () => 0,
      zAdd: async () => 1,
      zRem: async () => 1,
      zRangeByScore: async () => [],
      zCard: async () => 0,
    };
    const queue = DelayedEmailQueue.getInstance({ checkIntervalMs: 1_000_000 });
    await queue.initialize(async () => redis, async () => undefined);
    const params = {
      mailClass: 'ticket' as const,
      boardId: 'board-1',
      senderId: 'sender-1',
      to: 'client@example.test',
      subject: 'Ticket update',
      html: '<p>Ticket update</p>',
    };
    await queue.enqueue('tenant-1', params);
    const entry = [...stored.values()].map((value) => JSON.parse(value)).find((value) => value.params);
    expect(entry.params).toMatchObject({ mailClass: 'ticket', boardId: 'board-1', senderId: 'sender-1' });
    await queue.shutdown();
  });
});
