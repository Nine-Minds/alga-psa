/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), mark: vi.fn(), markAll: vi.fn(), fetch: vi.fn(), providers: [] as any[], polling: [] as any[] }));
vi.mock('@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions', () => ({
  getNotificationsAction: mocks.get, markAsReadAction: mocks.mark, markAllAsReadAction: mocks.markAll,
}));
vi.mock('@alga-psa/ui/hooks', async () => {
  const actual = await import('../../../../../packages/ui/src/hooks/useActionPolling');
  return { useActionPolling: (callback: () => Promise<void>, options: any) => {
    mocks.polling.push(options); return actual.useActionPolling(callback, options);
  } };
});
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class {
  options: any;
  configuration = { websocketProvider: { destroy: vi.fn() } };
  constructor(options: any) { this.options = options; mocks.providers.push(this); }
  connect() { this.options.onConnect(); }
  destroy() { this.options.onDisconnect(); }
} }));
import { useInternalNotifications } from '../../../../../packages/notifications/src/hooks/useInternalNotifications';
const tenant = 'home-tenant', userId = 'home-user';
const inbox = (message: string) => ({ notifications: [{ internal_notification_id: message, message, priority: 'high', is_read: false }], unread_count: 4, unread_high: 2 });
beforeEach(() => {
  mocks.providers.length = 0; mocks.polling.length = 0;
  mocks.get.mockReset().mockResolvedValue(inbox('Current authorized content'));
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ token: 'signed-token', tenant, userId, expiresAt: Date.now() + 60000, expiresInMs: 60000 }) });
  vi.stubGlobal('fetch', mocks.fetch); vi.stubEnv('NEXT_PUBLIC_HOCUSPOCUS_URL', 'ws://localhost:1234');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('uses authenticated signal rooms and ignores all Yjs notification content and counts', async () => {
  const { result, unmount } = renderHook(() => useInternalNotifications({ tenant, userId }));
  await waitFor(() => expect(result.current.isConnected).toBe(true));
  const provider = mocks.providers[0];
  expect(provider.options.name).toBe(`notification-signals:${tenant}:${userId}`);
  expect(provider.options.parameters).toEqual({ token: 'signed-token' });
  expect(provider.options.document.getMap('notifications').get('data')).toBeUndefined();
  act(() => {
    provider.options.document.getMap('notifications').set('data', [{ message: 'Stale shared secret' }]);
    provider.options.document.getMap('unreadCount').set('count', 9999);
  });
  expect(result.current.notifications[0].message).toBe('Current authorized content');
  expect(result.current.unreadCount).toBe(4); expect(result.current.highUnreadCount).toBe(2);
  // Polling is only the fallback while the socket is down.
  expect(mocks.polling.at(-1).enabled).toBe(false);
  mocks.get.mockResolvedValue(inbox('Reauthorized after signal'));
  await act(async () => { provider.options.onStateless({ payload: JSON.stringify({ type: 'notifications.changed', notification: { message: 'Untrusted body' } }) }); });
  expect(result.current.notifications[0].message).toBe('Reauthorized after signal');
  unmount();
  expect(provider.configuration.websocketProvider.destroy).toHaveBeenCalledOnce();
});

it('ring-only instances (enableInbox: false) never read the inbox, even on a changed signal or while disconnected', async () => {
  const { result } = renderHook(() => useInternalNotifications({ tenant, userId, limit: 1, enablePolling: false, enableInbox: false }));
  await waitFor(() => expect(result.current.isConnected).toBe(true));
  const provider = mocks.providers[0];
  await act(async () => { provider.options.onStateless({ payload: JSON.stringify({ type: 'notifications.changed' }) }); });
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.polling.every(options => options.enabled === false)).toBe(true);
  const call = { callId: 'call-1', participantId: 'p-1', dn: '101', contact: null };
  await act(async () => { provider.options.onStateless({ payload: JSON.stringify({ type: 'telephony.incoming_call', entry: { event: 'ringing', call, receivedAt: new Date().toISOString() } }) }); });
  expect(result.current.incomingCall).toMatchObject({ event: 'ringing', call });
});

it('polls only while disconnected', async () => {
  const { result } = renderHook(() => useInternalNotifications({ tenant, userId }));
  await waitFor(() => expect(result.current.isConnected).toBe(true));
  expect(mocks.polling.at(-1).enabled).toBe(false);
  act(() => { mocks.providers[0].options.onDisconnect(); });
  await waitFor(() => expect(result.current.isConnected).toBe(false));
  expect(mocks.polling.at(-1).enabled).toBe(true);
});

it('rotates the token about 15s before it expires (~285s for a 300s token) and refuses a token for another identity', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: 't1', tenant, userId, expiresAt: Date.now() + 300000, expiresInMs: 300000 }) });
    renderHook(() => useInternalNotifications({ tenant, userId }));
    await waitFor(() => expect(mocks.providers).toHaveLength(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(283_000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: 't2', tenant, userId, expiresAt: Date.now() + 300000, expiresInMs: 300000 }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.providers.at(-1).options.parameters).toEqual({ token: 't2' }));
  } finally { vi.useRealTimers(); }
});

it.each([
  ['20s behind', -20_000],
  ['10 minutes ahead', 600_000],
])('schedules rotation from expiresInMs, not expiresAt, with a browser clock %s', async (_label, skew) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    vi.setSystemTime(Date.now() + skew);
    // expiresAt is a server epoch that disagrees with the mocked browser clock.
    const serverEpoch = Date.now() - skew;
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: 't1', tenant, userId, expiresAt: serverEpoch + 300000, expiresInMs: 300000 }) });
    renderHook(() => useInternalNotifications({ tenant, userId }));
    await waitFor(() => expect(mocks.providers).toHaveLength(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(283_000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: 't2', tenant, userId, expiresAt: serverEpoch + 300000, expiresInMs: 300000 }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.providers.at(-1).options.parameters).toEqual({ token: 't2' }));
  } finally { vi.useRealTimers(); }
});

it('still constructs and connects the provider with the browser clock 10 minutes fast', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    vi.setSystemTime(Date.now() + 600_000);
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: 't1', tenant, userId, expiresAt: Date.now() - 600_000 + 300000, expiresInMs: 300000 }) });
    const { result } = renderHook(() => useInternalNotifications({ tenant, userId }));
    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(mocks.providers).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

it('treats a response without a positive expiresInMs as invalid', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: 'x', tenant, userId, expiresAt: Date.now() + 60000 }) });
  renderHook(() => useInternalNotifications({ tenant, userId }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  expect(mocks.providers).toHaveLength(0);
});

it.each([
  ['another user', { tenant, userId: 'someone-else' }],
  // The same user id under another tenant: the tenant half of the check must hold on its own.
  ['another tenant', { tenant: 'other-tenant', userId }],
])('does not open a socket when the token response names %s', async (_label, identity) => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: 'x', ...identity, expiresAt: Date.now() + 60000, expiresInMs: 60000 }) });
  const { result } = renderHook(() => useInternalNotifications({ tenant, userId }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  expect(mocks.providers).toHaveLength(0);
  expect(result.current.isConnected).toBe(false);
});

it('clears previous content when its current read fails', async () => {
  const { result } = renderHook(() => useInternalNotifications({ tenant, userId }));
  await waitFor(() => expect(result.current.notifications).toHaveLength(1));
  mocks.get.mockRejectedValue(new Error('Session revoked'));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.notifications).toEqual([]); expect(result.current.unreadCount).toBe(0); expect(result.current.highUnreadCount).toBe(0);
  expect(result.current.error).toBe('Failed to load notifications');
});

it('ignores an old in-flight response after the authenticated user context changes', async () => {
  const { result, rerender } = renderHook(props => useInternalNotifications(props), { initialProps: { tenant, userId } });
  await waitFor(() => expect(result.current.notifications).toHaveLength(1));
  let resolve!: (value: any) => void;
  mocks.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let pending!: Promise<void>;
  act(() => { pending = result.current.refresh(); });
  mocks.get.mockResolvedValue(inbox('Other home user'));
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: 'new-token', tenant, userId: 'other-user', expiresAt: Date.now() + 60000, expiresInMs: 60000 }) });
  rerender({ tenant, userId: 'other-user' });
  expect(result.current.notifications).toEqual([]);
  await act(async () => { resolve(inbox('Previous user secret')); await pending; });
  await waitFor(() => expect(result.current.notifications[0]?.message).toBe('Other home user'));
});

it('delivers a telephony ring to the card over the same authenticated signal channel', async () => {
  const { result } = renderHook(() => useInternalNotifications({ tenant, userId }));
  await waitFor(() => expect(result.current.isConnected).toBe(true));
  const provider = mocks.providers[0];
  const call = { callId: 'call-1', participantId: 'p-1', dn: '101', contact: null };
  const ring = (event: string, receivedAt = new Date().toISOString()) => act(async () => {
    provider.options.onStateless({ payload: JSON.stringify({ type: 'telephony.incoming_call', entry: { event, call, receivedAt } }) });
  });

  expect(result.current.incomingCall).toBeNull();
  await ring('ringing');
  expect(result.current.incomingCall).toMatchObject({ event: 'ringing', call });
  // The transport carries the ring; the document it happens to own never caches it.
  expect(provider.options.document.getMap('incomingCall').get('data')).toBeUndefined();
  expect(result.current.notifications[0].message).toBe('Current authorized content');

  act(() => { result.current.dismissIncomingCall(); });
  expect(result.current.incomingCall).toBeNull();

  // reduceIncomingCall still owns the fold: connected/ended clears the same call.
  await ring('ringing');
  await ring('ended');
  expect(result.current.incomingCall).toBeNull();

  // A ring older than the reducer's freshness window never reaches the card.
  await ring('ringing', new Date(Date.now() - 120_000).toISOString());
  expect(result.current.incomingCall).toBeNull();
});
