/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockProvider = ReturnType<typeof createMockProvider>;

const providers: MockProvider[] = [];
const createYjsProvider = vi.fn(() => {
  const provider = createMockProvider();
  providers.push(provider);

  return {
    provider,
    ydoc: {
      destroy: vi.fn(),
    },
  };
});

vi.mock('@alga-psa/ui/editor', () => ({
  createYjsProvider,
}));

function createMockProvider() {
  const handlers = new Map<string, Set<(payload?: any) => void>>();
  const awarenessStates = new Map<number, any>();

  const provider = {
    awareness: {
      getStates: vi.fn(() => awarenessStates),
      setLocalStateField: vi.fn((key: string, value: unknown) => {
        const previous = awarenessStates.get(1) ?? {};
        awarenessStates.set(1, { ...previous, [key]: value });
      }),
    },
    connect: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(),
    removeAllListeners: vi.fn(() => {
      handlers.clear();
    }),
    setConfiguration: vi.fn(),
    on: vi.fn((event: string, handler: (payload?: any) => void) => {
      if (!handlers.has(event)) {
        handlers.set(event, new Set());
      }
      handlers.get(event)?.add(handler);
      return provider;
    }),
    off: vi.fn((event: string, handler?: (payload?: any) => void) => {
      if (!handler) {
        handlers.delete(event);
        return provider;
      }

      handlers.get(event)?.delete(handler);
      return provider;
    }),
    emit: (event: string, payload?: any) => {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
  };

  return provider;
}

function createToken(claims: { iat: number; exp: number }) {
  const encode = (value: Record<string, unknown>) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

async function loadHook() {
  return import('./useTicketLive');
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useTicketLive', () => {
  beforeEach(() => {
    providers.length = 0;
    createYjsProvider.mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: createToken({
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 300,
        }),
      }),
    }) as any;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('T026: requests a token, opens a provider, and transitions connecting to connected', async () => {
    const { useTicketLive } = await loadHook();
    const { result } = renderHook(() =>
      useTicketLive({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        currentUser: { userId: 'user-1', displayName: 'Alice Example' },
      })
    );

    expect(result.current.connectionStatus).toBe('connecting');

    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/tickets/ticket-1/live-token', {
      method: 'GET',
      credentials: 'include',
    });
    expect(createYjsProvider).toHaveBeenCalledWith('ticket:tenant-1:ticket-1', expect.objectContaining({
      token: expect.any(String),
      connect: false,
    }));

    await act(async () => {
      providers[0]?.emit('status', { status: 'connected' });
    });

    expect(result.current.connectionStatus).toBe('connected');
  });

  it('T027: refreshes the JWT at 80% of the TTL and updates the provider token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    const { useTicketLive } = await loadHook();
    const refreshedToken = createToken({
      iat: Math.floor((Date.now() + 240000) / 1000),
      exp: Math.floor((Date.now() + 240000) / 1000) + 300,
    });

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: createToken({
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 300,
          }),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: refreshedToken }),
      });

    renderHook(() =>
      useTicketLive({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        currentUser: { userId: 'user-1', displayName: 'Alice Example' },
      })
    );

    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(240000);
    });

    await flushAsyncWork();
    expect(providers[0]?.setConfiguration).toHaveBeenCalledWith({ token: refreshedToken });
  });

  it('T028: transitions to unavailable when token refresh fails and stops retrying', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    const { useTicketLive } = await loadHook();
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: createToken({
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 300,
          }),
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    const { result } = renderHook(() =>
      useTicketLive({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        currentUser: { userId: 'user-1', displayName: 'Alice Example' },
      })
    );

    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(240000);
    });

    await flushAsyncWork();
    expect(result.current.connectionStatus).toBe('unavailable');

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('T029: retries reconnects with exponential backoff', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    const { useTicketLive } = await loadHook();
    renderHook(() =>
      useTicketLive({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        currentUser: { userId: 'user-1', displayName: 'Alice Example' },
      })
    );

    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);

    await act(async () => {
      providers[0]?.emit('status', { status: 'connected' });
      providers[0]?.emit('disconnect');
    });

    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(createYjsProvider).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(2);

    await act(async () => {
      providers[1]?.emit('disconnect');
      vi.advanceTimersByTime(1999);
    });
    expect(createYjsProvider).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(3);

    await act(async () => {
      providers[2]?.emit('disconnect');
      vi.advanceTimersByTime(4000);
    });
    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(4);
  });

  it('T030: marks the hook unavailable after five failed reconnect attempts and stops retrying', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    const { useTicketLive } = await loadHook();
    const { result } = renderHook(() =>
      useTicketLive({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        currentUser: { userId: 'user-1', displayName: 'Alice Example' },
      })
    );

    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);

    await act(async () => {
      providers[0]?.emit('status', { status: 'connected' });
      providers[0]?.emit('disconnect');
    });

    const reconnectDelays = [1000, 2000, 4000, 8000, 16000];
    for (let index = 0; index < reconnectDelays.length; index += 1) {
      await act(async () => {
        vi.advanceTimersByTime(reconnectDelays[index] ?? 0);
      });

      await flushAsyncWork();
      expect(createYjsProvider).toHaveBeenCalledTimes(index + 2);

      await act(async () => {
        providers[index + 1]?.emit('disconnect');
      });
    }

    await flushAsyncWork();
    expect(result.current.connectionStatus).toBe('unavailable');

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    expect(createYjsProvider).toHaveBeenCalledTimes(6);
  });

  it('T031: fires exactly one reconnect callback after a dropped connection reconnects', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    const { useTicketLive } = await loadHook();
    const onReconnect = vi.fn();

    renderHook(() =>
      useTicketLive({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        currentUser: { userId: 'user-1', displayName: 'Alice Example' },
        onReconnect,
      })
    );

    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);

    await act(async () => {
      providers[0]?.emit('status', { status: 'connected' });
      providers[0]?.emit('disconnect');
      vi.advanceTimersByTime(1000);
    });

    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(2);

    await act(async () => {
      providers[1]?.emit('status', { status: 'connected' });
      providers[1]?.emit('status', { status: 'connected' });
    });

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('T032: updates awareness when the active editing field changes', async () => {
    const { useTicketLive } = await loadHook();
    const { result } = renderHook(() =>
      useTicketLive({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        currentUser: { userId: 'user-1', displayName: 'Alice Example', avatarUrl: 'https://example.com/a.png' },
      })
    );

    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);

    await act(async () => {
      providers[0]?.emit('status', { status: 'connected' });
    });

    act(() => {
      result.current.setEditingField('status_id');
    });

    expect(providers[0]?.awareness.setLocalStateField).toHaveBeenLastCalledWith('user', expect.objectContaining({
      userId: 'user-1',
      displayName: 'Alice Example',
      avatarUrl: 'https://example.com/a.png',
      editingField: 'status_id',
    }));

    act(() => {
      result.current.setEditingField(null);
    });

    expect(providers[0]?.awareness.setLocalStateField).toHaveBeenLastCalledWith('user', expect.objectContaining({
      userId: 'user-1',
      displayName: 'Alice Example',
      avatarUrl: 'https://example.com/a.png',
    }));
    expect((providers[0]?.awareness.setLocalStateField as any).mock.calls.at(-1)?.[1]).not.toHaveProperty('editingField');
  });

  it('T055: awareness payload only includes the live presence allowlist fields', async () => {
    const { useTicketLive } = await loadHook();
    const { result } = renderHook(() =>
      useTicketLive({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        currentUser: {
          userId: 'user-1',
          displayName: 'Alice Example',
          avatarUrl: 'https://example.com/avatar.png',
          email: 'alice@example.com',
          role: 'admin',
        } as any,
      })
    );

    await flushAsyncWork();
    expect(createYjsProvider).toHaveBeenCalledTimes(1);

    await act(async () => {
      providers[0]?.emit('status', { status: 'connected' });
    });

    act(() => {
      result.current.setEditingField('status_id');
    });

    const payload = (providers[0]?.awareness.setLocalStateField as any).mock.calls.at(-1)?.[1];

    expect(payload).toEqual({
      userId: 'user-1',
      displayName: 'Alice Example',
      avatarUrl: 'https://example.com/avatar.png',
      color: expect.any(String),
      editingField: 'status_id',
    });
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('permissions');
  });
});
