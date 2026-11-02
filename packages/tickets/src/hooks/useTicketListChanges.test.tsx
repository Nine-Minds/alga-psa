/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providers: Array<{ handlers: Map<string, (value?: any) => void>; provider: any }> = [];
const createYjsProvider = vi.fn(() => {
  const handlers = new Map<string, (value?: any) => void>();
  const provider = {
    on: vi.fn((name: string, handler: (value?: any) => void) => { handlers.set(name, handler); return provider; }),
    disconnect: vi.fn(() => { handlers.get('disconnect')?.(); }),
    removeAllListeners: vi.fn(), destroy: vi.fn(), setConfiguration: vi.fn(),
  };
  providers.push({ handlers, provider });
  return { provider, ydoc: { destroy: vi.fn() } };
});
vi.mock('@alga-psa/ui/editor', () => ({ createYjsProvider }));

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

describe('useTicketListChanges', () => {
  beforeEach(() => {
    providers.length = 0;
    createYjsProvider.mockClear();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'token', expiresAt: Date.now() + 300_000 }) }) as any;
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('delivers enriched changes without dropping filter metadata', async () => {
    const { useTicketListChanges } = await import('./useTicketListChanges');
    const onChange = vi.fn();
    renderHook(() => useTicketListChanges('tenant-a', onChange));
    await flush();
    const event = {
      ticketId: 'ticket-a', changeKind: 'updated', boardId: 'board-a', statusId: 'status-a',
      assigneeIds: ['user-a'], primaryAssigneeId: 'user-a', teamIds: ['team-a'], priorityId: 'high',
      dueDate: '2026-11-03T00:00:00Z', tags: ['urgent'], filterRecord: { priority_id: 'high' },
      searchText: 'Printer offline', actorUserId: 'other', updatedAt: new Date().toISOString(),
    };
    await act(async () => { providers[0].handlers.get('stateless')?.({ payload: JSON.stringify(event) }); });
    expect(onChange).toHaveBeenCalledWith(event);
  });

  it('recovers after a stale connection and reports an unavailable feed after repeated failures', async () => {
    vi.useFakeTimers();
    const { useTicketListChanges } = await import('./useTicketListChanges');
    const unavailable = vi.fn();
    const recovered = vi.fn();
    renderHook(() => useTicketListChanges('tenant-a', vi.fn(), { onUnavailable: unavailable, onRecovered: recovered }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { providers[0].handlers.get('authenticated')?.(); });
    await act(async () => { providers[0].handlers.get('disconnect')?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    await act(async () => { providers[1].handlers.get('authenticated')?.(); });
    expect(recovered).toHaveBeenCalledTimes(2);

    (global.fetch as any).mockRejectedValue(new Error('offline'));
    await act(async () => { providers[1].handlers.get('disconnect')?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100_000); });
    expect(unavailable).toHaveBeenCalled();
  });

  it('reconnects with a renewed token before the relay principal expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const { useTicketListChanges } = await import('./useTicketListChanges');
    renderHook(() => useTicketListChanges('tenant-a', vi.fn()));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(createYjsProvider).toHaveBeenCalledTimes(1);
    await act(async () => { providers[0].handlers.get('authenticated')?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(270_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(createYjsProvider).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await act(async () => { providers[1].handlers.get('authenticated')?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(272_100); });
    expect(createYjsProvider).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('recovers the initial subscription gap when the first successful connection follows token failures', async () => {
    vi.useFakeTimers();
    const { useTicketListChanges } = await import('./useTicketListChanges');
    const unavailable = vi.fn();
    const recovered = vi.fn();
    (global.fetch as any).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useTicketListChanges('tenant-a', vi.fn(), { onUnavailable: unavailable, onRecovered: recovered }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100_000); });
    expect(unavailable.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(createYjsProvider).toHaveBeenCalledTimes(1);
    await act(async () => { providers[0].handlers.get('authenticated')?.(); });
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it('does not treat socket/status events as readiness and preserves exponential retry plus the 60-second recovery cadence', async () => {
    vi.useFakeTimers();
    const { useTicketListChanges } = await import('./useTicketListChanges');
    const unavailable = vi.fn();
    const recovered = vi.fn();
    renderHook(() => useTicketListChanges('tenant-a', vi.fn(), { onUnavailable: unavailable, onRecovered: recovered }));
    await flush();

    await act(async () => {
      providers[0].handlers.get('connect')?.();
      providers[0].handlers.get('status')?.({ status: 'connected' });
      providers[0].handlers.get('authenticationFailed')?.();
      providers[0].handlers.get('close')?.();
      providers[0].handlers.get('disconnect')?.();
    });
    expect(recovered).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(createYjsProvider).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(createYjsProvider).toHaveBeenCalledTimes(2);
    const retryIntervals = [4_000, 8_000, 16_000];
    for (const interval of retryIntervals) {
      await act(async () => { providers[providers.length - 1].handlers.get('authenticationFailed')?.(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(interval); });
    }
    await act(async () => { providers[providers.length - 1].handlers.get('authenticationFailed')?.(); });
    expect(unavailable).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(unavailable).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(unavailable).toHaveBeenCalledTimes(2);
    await act(async () => { providers[providers.length - 1].handlers.get('authenticated')?.(); });
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledTimes(2);
  });

  it('cleans provider listeners and scheduled reconnects on unmount', async () => {
    vi.useFakeTimers();
    const { useTicketListChanges } = await import('./useTicketListChanges');
    const { unmount } = renderHook(() => useTicketListChanges('tenant-a', vi.fn()));
    await flush();
    providers[0].handlers.get('authenticationFailed')?.();
    unmount();
    expect(providers[0].provider.removeAllListeners).toHaveBeenCalled();
    expect(providers[0].provider.destroy).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(createYjsProvider).toHaveBeenCalledTimes(1);
  });
});
