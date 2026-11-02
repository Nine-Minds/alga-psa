/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providers: Array<{ handlers: Map<string, (value?: any) => void>; provider: any; token: () => Promise<string> }> = [];
const createYjsProvider = vi.fn((_room: string, options: any) => {
  const handlers = new Map<string, (value?: any) => void>();
  const websocketHandlers = new Map<string, Set<(value?: any) => void>>();
  const emitWebsocket = (name: string, value?: any) => websocketHandlers.get(name)?.forEach(handler => handler(value));
  const websocketProvider = {
    status: 'disconnected',
    on: vi.fn((name: string, handler: (value?: any) => void) => {
      const listeners = websocketHandlers.get(name) ?? new Set();
      listeners.add(handler);
      websocketHandlers.set(name, listeners);
    }),
    off: vi.fn((name: string, handler: (value?: any) => void) => websocketHandlers.get(name)?.delete(handler)),
    disconnect: vi.fn(() => { websocketProvider.status = 'disconnected'; emitWebsocket('status', { status: 'disconnected' }); }),
    connect: vi.fn(() => { websocketProvider.status = 'connected'; handlers.get('open')?.(); }),
  };
  const provider = {
    isAuthenticated: false,
    configuration: { websocketProvider },
    connect: vi.fn(() => websocketProvider.connect()),
    on: vi.fn((name: string, handler: (value?: any) => void) => { handlers.set(name, handler); return provider; }),
    removeAllListeners: vi.fn(), destroy: vi.fn(),
  };
  providers.push({ handlers, provider, token: options.token });
  return { provider, ydoc: { destroy: vi.fn() } };
});
vi.mock('@alga-psa/ui/editor', () => ({ createYjsProvider }));

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

beforeEach(() => {
  providers.length = 0;
  createYjsProvider.mockClear();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'token' }) }) as any;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useTicketListChanges', () => {
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
    await expect(providers[0].token()).resolves.toBe('token');
    expect(global.fetch).toHaveBeenCalledWith('/api/tickets/live-token', { credentials: 'include', cache: 'no-store' });
  });

  it('uses one websocket owner for exponential rejected-auth retries and bounds outage recovery calls', async () => {
    vi.useFakeTimers();
    const { useTicketListChanges } = await import('./useTicketListChanges');
    const unavailable = vi.fn();
    const recovered = vi.fn();
    renderHook(() => useTicketListChanges('tenant-a', vi.fn(), { onUnavailable: unavailable, onRecovered: recovered }));
    await flush();

    const current = providers[0];
    current.handlers.get('authenticationFailed')?.();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(current.provider.connect).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(current.provider.connect).toHaveBeenCalledTimes(1);
    current.handlers.get('authenticationFailed')?.();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_999); });
    expect(current.provider.connect).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(current.provider.connect).toHaveBeenCalledTimes(2);
    current.handlers.get('authenticationFailed')?.();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(current.provider.connect).toHaveBeenCalledTimes(3);
    current.handlers.get('authenticationFailed')?.();
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(current.provider.connect).toHaveBeenCalledTimes(4);
    current.handlers.get('authenticationFailed')?.();
    expect(unavailable).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(unavailable).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(unavailable).toHaveBeenCalledTimes(2);

    current.provider.isAuthenticated = true;
    current.handlers.get('authenticated')?.();
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(createYjsProvider).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending retry when automatic transport reconnection is authorized', async () => {
    vi.useFakeTimers();
    const { useTicketListChanges } = await import('./useTicketListChanges');
    const recovered = vi.fn();
    renderHook(() => useTicketListChanges('tenant-a', vi.fn(), { onRecovered: recovered }));
    await flush();
    const current = providers[0];
    current.provider.isAuthenticated = true;
    current.handlers.get('authenticated')?.();
    current.handlers.get('disconnect')?.();
    current.handlers.get('authenticationFailed')?.();
    current.provider.isAuthenticated = true;
    current.handlers.get('open')?.();
    current.handlers.get('authenticated')?.();
    await act(async () => { await vi.advanceTimersByTimeAsync(35_000); });
    expect(current.provider.connect).not.toHaveBeenCalled();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);
    expect(recovered).toHaveBeenCalledTimes(2);
  });

  it('cleans provider listeners and scheduled retries on unmount', async () => {
    vi.useFakeTimers();
    const { useTicketListChanges } = await import('./useTicketListChanges');
    const { unmount } = renderHook(() => useTicketListChanges('tenant-a', vi.fn()));
    await flush();
    providers[0].handlers.get('authenticationFailed')?.();
    unmount();
    expect(providers[0].provider.removeAllListeners).toHaveBeenCalled();
    expect(providers[0].provider.destroy).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(providers[0].provider.connect).not.toHaveBeenCalled();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);
  });
});
