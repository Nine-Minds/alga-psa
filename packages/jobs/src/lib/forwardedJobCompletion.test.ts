import { describe, expect, it, vi } from 'vitest';
import { waitForForwardedJobCompletion } from './forwardedJobCompletion';

describe('waitForForwardedJobCompletion', () => {
  it('does not treat an unconsumed event as completed work', async () => {
    const sleep = vi.fn(async () => undefined);
    await expect(waitForForwardedJobCompletion(
      async () => ({ status: 'queued' }),
      { timeoutMs: 2, pollIntervalMs: 1, sleep },
    )).rejects.toThrow('Timed out waiting for the application server');
    expect(sleep).toHaveBeenCalled();
  });

  it('resolves only after the application handler records completion', async () => {
    const states = [
      { status: 'queued' },
      { status: 'processing' },
      { status: 'completed' },
    ];
    await expect(waitForForwardedJobCompletion(
      async () => states.shift(),
      { timeoutMs: 100, pollIntervalMs: 1, sleep: async () => undefined },
    )).resolves.toBeUndefined();
  });

  it('propagates a downstream handler failure', async () => {
    await expect(waitForForwardedJobCompletion(
      async () => ({ status: 'failed', error: 'PDF storage unavailable' }),
      { timeoutMs: 100, sleep: async () => undefined },
    )).rejects.toThrow('PDF storage unavailable');
  });
});
