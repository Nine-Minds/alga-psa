import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStaleActionState } from '../lib/staleActionState';
import { useActionPolling } from './useActionPolling';

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useActionPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('halts permanently and marks the client stale for an unrecognized action', async () => {
    const staleError = Object.assign(new Error('action missing'), {
      name: 'UnrecognizedActionError',
    });
    const action = vi.fn().mockRejectedValue(staleError);

    renderHook(() => useActionPolling(action, { intervalMs: 1000 }));
    await flushPromises();

    expect(action).toHaveBeenCalledTimes(1);
    expect(getStaleActionState()).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('backs off after transient failures and resets after a success', async () => {
    const action = vi.fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValue(undefined);

    renderHook(() => useActionPolling(action, {
      intervalMs: 1000,
      maxBackoffMs: 8000,
    }));
    await flushPromises();

    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(action).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(action).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(action).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(action).toHaveBeenCalledTimes(4);
  });

  it('clears a scheduled poll when unmounted', async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useActionPolling(action, {
      intervalMs: 1000,
      runImmediately: false,
    }));

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(action).not.toHaveBeenCalled();
  });
});
