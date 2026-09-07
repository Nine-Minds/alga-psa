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
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ token: 'signed-token', tenant, userId, expiresAt: Date.now() + 60000 }) });
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
  expect(mocks.polling.at(-1).enabled).toBe(true);
  mocks.get.mockResolvedValue(inbox('Reauthorized after signal'));
  await act(async () => { provider.options.onStateless({ payload: JSON.stringify({ type: 'notifications.changed', notification: { message: 'Untrusted body' } }) }); });
  expect(result.current.notifications[0].message).toBe('Reauthorized after signal');
  unmount();
  expect(provider.configuration.websocketProvider.destroy).toHaveBeenCalledOnce();
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
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: 'new-token', tenant, userId: 'other-user', expiresAt: Date.now() + 60000 }) });
  rerender({ tenant, userId: 'other-user' });
  expect(result.current.notifications).toEqual([]);
  await act(async () => { resolve(inbox('Previous user secret')); await pending; });
  await waitFor(() => expect(result.current.notifications[0]?.message).toBe('Other home user'));
});
