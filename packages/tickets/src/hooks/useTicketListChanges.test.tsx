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
    await act(async () => { providers[0].handlers.get('connect')?.(); });
    await act(async () => { providers[0].handlers.get('disconnect')?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    await act(async () => { providers[1].handlers.get('connect')?.(); });
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
    await act(async () => { providers[0].handlers.get('connect')?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(270_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(createYjsProvider).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
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
    expect(unavailable).toHaveBeenCalled();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);
    await act(async () => { providers[0].handlers.get('connect')?.(); });
    expect(recovered).toHaveBeenCalledTimes(1);
  });
});
