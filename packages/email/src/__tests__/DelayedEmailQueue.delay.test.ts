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
});
