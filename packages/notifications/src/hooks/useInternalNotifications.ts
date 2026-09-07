'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useActionPolling } from '@alga-psa/ui/hooks';
import type { InternalNotification } from '../types/internalNotification';
import { getNotificationsAction, markAsReadAction, markAllAsReadAction } from '../actions/internal-notification-actions/internalNotificationActions';

function getHocuspocusUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
  if (typeof window === 'undefined') return configured || null;
  const { protocol, host } = window.location;
  return !host.includes('localhost') ? `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/hocuspocus` : configured || null;
}

interface UseInternalNotificationsOptions { tenant: string; userId: string; limit?: number; enablePolling?: boolean }
interface UseInternalNotificationsReturn {
  notifications: InternalNotification[]; unreadCount: number; highUnreadCount: number;
  isConnected: boolean; isLoading: boolean; error: string | null;
  markAsRead: (notificationId: string) => Promise<void>; markAllAsRead: () => Promise<void>; refresh: () => Promise<void>;
}
const EMPTY = { notifications: [] as InternalNotification[], unreadCount: 0, highUnreadCount: 0 };

export function useInternalNotifications(options: UseInternalNotificationsOptions): UseInternalNotificationsReturn {
  const { tenant, userId, limit = 20, enablePolling = true } = options;
  const scope = `${tenant}:${userId}:${limit}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const requestId = useRef(0);
  const loadedScope = useRef<string | null>(null);
  const [inbox, setInbox] = useState({ scope, ...EMPTY });
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    const id = ++requestId.current;
    const current = () => currentScope.current === scope && requestId.current === id;
    if (!tenant || !userId) {
      setInbox({ scope, ...EMPTY }); setIsLoading(false); return;
    }
    try {
      const response = await getNotificationsAction({ tenant, user_id: userId, limit });
      if (!current()) return;
      loadedScope.current = scope;
      setInbox({ scope, notifications: response.notifications, unreadCount: response.unread_count,
        highUnreadCount: response.unread_high ?? response.notifications.filter(row => !row.is_read && row.priority === 'high').length });
      setError(null);
    } catch (error) {
      // A failed refresh cannot leave previously shared content as an apparent
      // current read. In-flight responses from an old identity are ignored too.
      if (current()) { loadedScope.current = scope; setInbox({ scope, ...EMPTY }); setError('Failed to load notifications'); }
      throw error;
    } finally { if (current()) setIsLoading(false); }
  }, [scope, tenant, userId, limit]);

  const { runNow: refresh } = useActionPolling(fetchNotifications, {
    intervalMs: 30000,
    // Revalidate even while connected: revocation need not create a new event.
    enabled: enablePolling && Boolean(tenant && userId), runImmediately: false,
  });

  useEffect(() => {
    setIsLoading(true); setError(null);
    void refresh().then(() => {
      // Polling coalesces concurrent requests. If this waited for an old user's
      // request, immediately fetch the new scope after that request settles.
      if (currentScope.current === scope && loadedScope.current !== scope) void refresh();
    });
    return () => { requestId.current++; };
  }, [scope, refresh]);

  useEffect(() => {
    const url = getHocuspocusUrl();
    setIsConnected(false);
    if (!url || !tenant || !userId) return;
    let disposed = false, generation = 0, delay = 1000;
    let provider: HocuspocusProvider | undefined;
    let document: Y.Doc | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const destroy = () => {
      const old = provider; provider = undefined;
      old?.destroy();
      // This provider owns its socket. Hocuspocus v2 detaches the document but
      // leaves the socket's connection-check interval alive after destroy().
      old?.configuration.websocketProvider.destroy();
      document?.destroy(); document = undefined;
    };
    const schedule = (wait: number) => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void connect(); }, wait);
    };
    const connect = async () => {
      const attempt = ++generation;
      destroy(); setIsConnected(false);
      try {
        const response = await fetch('/api/notifications/live-token', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error('Notification stream authentication failed');
        const access = await response.json() as { token: string; tenant: string; userId: string; expiresAt: number };
        if (disposed || attempt !== generation) return;
        if (!access.token || access.tenant !== tenant || access.userId !== userId || !Number.isFinite(access.expiresAt) || access.expiresAt <= Date.now()) {
          throw new Error('Invalid notification stream identity');
        }
        document = new Y.Doc();
        const next = new HocuspocusProvider({ url, name: `notification-signals:${tenant}:${userId}`, document,
          parameters: { token: access.token }, connect: false,
          onConnect: () => { if (!disposed && provider === next) { setIsConnected(true); delay = 1000; void refresh(); } },
          onDisconnect: () => { if (!disposed && provider === next) { setIsConnected(false); schedule(delay); delay = Math.min(30000, delay * 2); } },
          onStateless: ({ payload }) => {
            if (disposed || provider !== next) return;
            try { if (JSON.parse(payload)?.type === 'notifications.changed') void refresh(); } catch { /* Ignore malformed hints. */ }
          },
        });
        provider = next;
        // Neither fetch results nor messages/counts from a Yjs map are trusted
        // or written here. The socket carries only a request to refresh.
        next.connect();
        schedule(Math.max(1000, access.expiresAt - Date.now() - 5000));
      } catch {
        if (!disposed && attempt === generation) { schedule(delay); delay = Math.min(30000, delay * 2); void refresh(); }
      }
    };
    void connect();
    return () => { disposed = true; generation++; if (timer) clearTimeout(timer); destroy(); };
  }, [tenant, userId, refresh]);

  const markAsRead = useCallback(async (notificationId: string) => {
    await markAsReadAction(tenant, userId, notificationId); await refresh();
  }, [tenant, userId, refresh]);
  const markAllAsRead = useCallback(async () => {
    await markAllAsReadAction(tenant, userId); await refresh();
  }, [tenant, userId, refresh]);

  const visible = inbox.scope === scope ? inbox : EMPTY;
  return { notifications: visible.notifications, unreadCount: visible.unreadCount, highUnreadCount: visible.highUnreadCount,
    isConnected, isLoading, error, markAsRead, markAllAsRead, refresh };
}
