// @ts-nocheck
// TODO: Action argument count issues
	"use client";
	
	
	import { useState, useEffect, useCallback, useRef } from 'react';
	import * as Y from 'yjs';
	import { HocuspocusProvider } from '@hocuspocus/provider';
import { useActionPolling } from '@alga-psa/ui/hooks';
import type {
  InternalNotification,
  InternalNotificationListResponse,
} from '@alga-psa/notifications';
import {
  getNotificationsAction,
  markAsReadAction,
  markAllAsReadAction,
	} from '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions';
import { reduceIncomingCall, type IncomingCallEntry } from './incomingCall';
	
	// Choose the Hocuspocus URL from the build environment, never the hostname,
	// so a dev server reached over a LAN/tailnet address still targets the
	// configured local Hocuspocus instance instead of deriving a same-origin URL.
	// Development: NEXT_PUBLIC_HOCUSPOCUS_URL, defaulting to ws://localhost:1234.
	// Production: NEXT_PUBLIC_HOCUSPOCUS_URL, otherwise ws(s)://{host}/hocuspocus.
	export const getHocuspocusUrl = () => {
	  const configuredUrl = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;

	  if (process.env.NODE_ENV !== 'production') {
	    return configuredUrl || 'ws://localhost:1234';
	  }

	  if (configuredUrl) {
	    return configuredUrl;
	  }

	  // This hook can be rendered on the server as part of Client Component SSR.
	  // The connection is only opened from a client effect, so the SSR fallback
	  // is never baked into the HTML.
	  if (typeof window === 'undefined') {
	    return configuredUrl || null;
	  }

	  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	  return `${protocol}//${window.location.host}/hocuspocus`;
	};
	const POLLING_INTERVAL = 30000;
	const MAX_RECONNECT_DELAY = 30000;
	const INITIAL_RECONNECT_DELAY = 1000;
	// Tokens live 300s (hocuspocus caps exp - iat at 300). Reconnect with a fresh
	// one shortly before expiry: ~285s, not the 55s a 60s token would force.
	const TOKEN_ROTATION_LEAD_MS = 15000;

interface UseInternalNotificationsOptions {
  tenant: string;
  userId: string;
  limit?: number;
  enablePolling?: boolean;
  /**
   * When false the hook is ring-only: it never reads the inbox, neither on
   * connect, on a `notifications.changed` signal, nor by polling. Used by
   * IncomingCallProvider so its second socket does not double the inbox reads.
   */
  enableInbox?: boolean;
}

interface UseInternalNotificationsReturn {
  notifications: InternalNotification[];
  unreadCount: number;
  // Unread count of `high`-priority notifications, for the priority-aware bell badge.
  highUnreadCount: number;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Latest ringing call for this user, until connected/ended, dismiss, or expiry. */
  incomingCall: IncomingCallEntry | null;
  dismissIncomingCall: () => void;
}

const EMPTY = { notifications: [] as InternalNotification[], unreadCount: 0, highUnreadCount: 0 };

export function useInternalNotifications(
  options: UseInternalNotificationsOptions
): UseInternalNotificationsReturn {
  const { tenant, userId, limit = 20, enablePolling = true, enableInbox = true } = options;
  const scope = `${tenant}:${userId}:${limit}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const requestId = useRef(0);
  const loadedScope = useRef<string | null>(null);

  const [inbox, setInbox] = useState({ scope, ...EMPTY });
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(enableInbox);
  const [error, setError] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallEntry | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!enableInbox) {
      setIsLoading(false);
      return;
    }
    const id = ++requestId.current;
    const current = () => currentScope.current === scope && requestId.current === id;
    if (!tenant || !userId) {
      setInbox({ scope, ...EMPTY });
      setError(null);
      setIsLoading(false);
      return;
    }

    try {
      const response: InternalNotificationListResponse = await getNotificationsAction({
        tenant,
        user_id: userId,
        limit,
      });
      if (!current()) return;
      loadedScope.current = scope;
      setInbox({
        scope,
        notifications: response.notifications,
        unreadCount: response.unread_count,
        // Prefer the server's authoritative unread-high count; fall back to
        // deriving it from the loaded page for older payloads.
        highUnreadCount:
          typeof response.unread_high === 'number'
            ? response.unread_high
            : response.notifications.filter((n) => !n.is_read && n.priority === 'high').length,
      });
      setError(null);
    } catch (err) {
      // A failed read must not leave earlier content looking current, and a
      // response for a previous identity is ignored.
      if (current()) {
        loadedScope.current = scope;
        setInbox({ scope, ...EMPTY });
        setError('Failed to load notifications');
      }
      throw err;
    } finally {
      if (current()) setIsLoading(false);
    }
  }, [enableInbox, scope, tenant, userId, limit]);

  const { runNow: refreshNow } = useActionPolling(fetchNotifications, {
    intervalMs: POLLING_INTERVAL,
    // The socket only signals; polling is the fallback while it is down.
    enabled: enablePolling && enableInbox && !isConnected && Boolean(tenant && userId),
    runImmediately: false,
  });

  useEffect(() => {
    if (!enableInbox) return undefined;
    setIsLoading(true);
    setError(null);
    void refreshNow().then(() => {
      // Polling coalesces concurrent requests. If this waited on a previous
      // identity's request, read the new scope once that settles.
      if (currentScope.current === scope && loadedScope.current !== scope) void refreshNow();
    });
    return () => {
      requestId.current++;
    };
  }, [enableInbox, scope, refreshNow]);

  useEffect(() => {
    const url = getHocuspocusUrl();
    setIsConnected(false);
    // A ring belongs to one identity's socket; never let it outlive that socket.
    setIncomingCall(null);
    if (!url || !tenant || !userId) return undefined;

    let disposed = false;
    let generation = 0;
    let delay = INITIAL_RECONNECT_DELAY;
    let provider: HocuspocusProvider | undefined;
    let ydoc: Y.Doc | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const destroy = () => {
      const old = provider;
      provider = undefined;
      old?.destroy();
      // This provider owns its socket. Hocuspocus v2 detaches the document but
      // leaves the socket's connection-check interval alive after destroy().
      old?.configuration.websocketProvider.destroy();
      ydoc?.destroy();
      ydoc = undefined;
    };

    const schedule = (wait: number) => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void connect();
      }, wait);
    };

    const backoff = () => {
      schedule(delay);
      delay = Math.min(MAX_RECONNECT_DELAY, delay * 2);
    };

    const connect = async () => {
      const attempt = ++generation;
      destroy();
      setIsConnected(false);
      try {
        // A fresh token per connection: the signer only mints for a live session.
        const response = await fetch('/api/notifications/live-token', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Notification stream authentication failed');
        const access = (await response.json()) as {
          token: string;
          tenant: string;
          userId: string;
          expiresAt: number;
          expiresInMs: number;
        };
        const receivedAt = Date.now();
        if (disposed || attempt !== generation) return;
        if (
          !access.token ||
          access.tenant !== tenant ||
          access.userId !== userId ||
          // Relative to the server's clock; expiresAt is never compared with the browser's.
          !Number.isFinite(access.expiresInMs) ||
          access.expiresInMs <= 0
        ) {
          throw new Error('Invalid notification stream identity');
        }

        ydoc = new Y.Doc();
        const next: HocuspocusProvider = new HocuspocusProvider({
          url,
          name: `notification-signals:${tenant}:${userId}`,
          document: ydoc,
          parameters: { token: access.token },
          connect: false,
          onConnect: () => {
            if (disposed || provider !== next) return;
            setIsConnected(true);
            delay = INITIAL_RECONNECT_DELAY;
            void refreshNow();
          },
          onDisconnect: () => {
            if (disposed || provider !== next) return;
            setIsConnected(false);
            backoff();
          },
          onStateless: ({ payload }) => {
            if (disposed || provider !== next) return;
            let signal: { type?: string; entry?: unknown } | null = null;
            try {
              signal = JSON.parse(payload);
            } catch {
              return; // Ignore malformed hints.
            }
            if (signal?.type === 'notifications.changed') {
              void refreshNow();
              return;
            }
            // The ring is transient UI state on the same per-connection filtered
            // stateless channel. It is never merged into the inbox nor read back
            // from a document, so no later connection can replay it.
            if (signal?.type === 'telephony.incoming_call') {
              setIncomingCall((current) => reduceIncomingCall(current, signal!.entry));
            }
          },
        });
        provider = next;
        // Nothing in the Yjs document is trusted or read: the socket carries
        // only a request to refresh (inbox) or the transient ring.
        next.connect();
        schedule(Math.max(1000, receivedAt + access.expiresInMs - TOKEN_ROTATION_LEAD_MS - Date.now()));
      } catch {
        if (!disposed && attempt === generation) {
          backoff();
          void refreshNow();
        }
      }
    };

    void connect();
    return () => {
      disposed = true;
      generation++;
      if (timer) clearTimeout(timer);
      destroy();
    };
  }, [tenant, userId, refreshNow]);

  const markAsRead = useCallback(
    async (notificationId: string) => {
      try {
        await markAsReadAction(tenant, userId, notificationId);
        await refreshNow();
      } catch (err) {
        console.error('Failed to mark notification as read:', err);
      }
    },
    [tenant, userId, refreshNow]
  );

  const markAllAsRead = useCallback(async () => {
    try {
      await markAllAsReadAction(tenant, userId);
      await refreshNow();
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  }, [tenant, userId, refreshNow]);

  const dismissIncomingCall = useCallback(() => setIncomingCall(null), []);

  const visible = inbox.scope === scope ? inbox : EMPTY;
  return {
    notifications: visible.notifications,
    unreadCount: visible.unreadCount,
    highUnreadCount: visible.highUnreadCount,
    isConnected,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    refresh: refreshNow,
    incomingCall,
    dismissIncomingCall,
  };
}
