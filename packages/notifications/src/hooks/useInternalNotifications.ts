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
  UnreadCountResponse,
} from '@alga-psa/notifications';
import {
  getNotificationsAction,
  getUnreadCountAction,
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

interface UseInternalNotificationsOptions {
  tenant: string;
  userId: string;
  limit?: number;
  enablePolling?: boolean;
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

export function useInternalNotifications(
  options: UseInternalNotificationsOptions
): UseInternalNotificationsReturn {
  const { tenant, userId, limit = 20, enablePolling = true } = options;

  const [notifications, setNotifications] = useState<InternalNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [highUnreadCount, setHighUnreadCount] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallEntry | null>(null);

  const providerRef = useRef<HocuspocusProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef<number>(INITIAL_RECONNECT_DELAY);

  const fetchNotifications = useCallback(async () => {
    if (!tenant || !userId) {
      setNotifications([]);
      setUnreadCount(0);
      setHighUnreadCount(0);
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
      setNotifications(response.notifications);
      setUnreadCount(response.unread_count);
      // Prefer the server's authoritative unread-high count; fall back to
      // deriving it from the loaded page for older payloads.
      setHighUnreadCount(
        typeof response.unread_high === 'number'
          ? response.unread_high
          : response.notifications.filter((n) => !n.is_read && n.priority === 'high').length
      );
      setError(null);

      if (ydocRef.current && providerRef.current?.status === 'connected') {
        const notificationsMap = ydocRef.current.getMap('notifications');
        const unreadCountMap = ydocRef.current.getMap('unreadCount');

        notificationsMap.set('data', response.notifications);
        unreadCountMap.set('count', response.unread_count);
        if (typeof response.unread_high === 'number') {
          unreadCountMap.set('high', response.unread_high);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [tenant, userId, limit]);

	  const fetchUnreadCount = useCallback(async () => {
	    if (!tenant || !userId) {
	      setUnreadCount(0);
	      return;
	    }
	
	    try {
	      const response: UnreadCountResponse = await getUnreadCountAction(tenant, userId);
	      setUnreadCount(response.unread_count);
	      if (typeof response.high === 'number') {
	        setHighUnreadCount(response.high);
	      }
    } catch (err) {
      console.error('Failed to fetch unread count:', err);
    }
  }, [tenant, userId]);

  const { runNow: pollNotificationsNow } = useActionPolling(fetchNotifications, {
    intervalMs: POLLING_INTERVAL,
    enabled: enablePolling && !isConnected && Boolean(tenant && userId),
    runImmediately: false,
    onError: () => setError('Failed to load notifications'),
  });

  const setupWebSocket = useCallback(() => {
	    if (!tenant || !userId) {
	      setIsConnected(false);
	      return () => {};
	    }

    const hocuspocusUrl = getHocuspocusUrl();
    if (!hocuspocusUrl) {
      setIsConnected(false);
      return () => {};
    }

	    const roomName = `notifications:${tenant}:${userId}`;
	    const ydoc = new Y.Doc();
	    const provider = new HocuspocusProvider({
	      url: hocuspocusUrl,
	      name: roomName,
	      document: ydoc,
	
	      onConnect: () => {
        console.log('Connected to notification stream');
        setIsConnected(true);
        setError(null);
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;

        void pollNotificationsNow();
      },

      onDisconnect: ({ event }) => {
        console.log('Disconnected from notification stream', event);
        setIsConnected(false);

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log(`Attempting to reconnect in ${reconnectDelayRef.current}ms...`);
          provider.connect();
          reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, MAX_RECONNECT_DELAY);
        }, reconnectDelayRef.current);
      },

      onDestroy: () => {
        console.log('Notification provider destroyed');
        setIsConnected(false);
      },
    });

    providerRef.current = provider;
    ydocRef.current = ydoc;

    const notificationsMap = ydoc.getMap('notifications');
    const unreadCountMap = ydoc.getMap('unreadCount');

    notificationsMap.observe(() => {
      const notifData = notificationsMap.get('data');
      if (notifData) {
        const list = notifData as InternalNotification[];
        setNotifications(list);
        // A shared Yjs document can contain only another consumer's limited
        // notification window. Recount against the database instead of deriving
        // the bell badge from that incomplete page.
        void fetchUnreadCount();
      }
    });

    unreadCountMap.observe((event) => {
      const count = unreadCountMap.get('count');
      if (typeof count === 'number') {
        setUnreadCount(count);
      }
      const high = unreadCountMap.get('high');
      if (event.keysChanged.has('high') && typeof high === 'number') {
        setHighUnreadCount(high);
      } else if (event.keysChanged.has('count')) {
        void fetchUnreadCount();
      }
    });

    const incomingCallMap = ydoc.getMap('incomingCall');
    incomingCallMap.observe(() => {
      const entry = incomingCallMap.get('data');
      setIncomingCall((current) => reduceIncomingCall(current, entry));
    });

    return () => {
      provider.destroy();
      ydoc.destroy();
    };
  }, [fetchUnreadCount, pollNotificationsNow, tenant, userId]);

  useEffect(() => {
    setIsLoading(true);
    void pollNotificationsNow();

    const cleanup = setupWebSocket();

    return () => {
      cleanup();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [pollNotificationsNow, setupWebSocket]);

  const markAsRead = useCallback(
    async (notificationId: string) => {
      try {
        await markAsReadAction(tenant, userId, notificationId);
        await fetchNotifications();
        await fetchUnreadCount();
      } catch (err) {
        console.error('Failed to mark notification as read:', err);
      }
    },
    [tenant, userId, fetchNotifications, fetchUnreadCount]
  );

  const markAllAsRead = useCallback(async () => {
    try {
      await markAllAsReadAction(tenant, userId);
      await fetchNotifications();
      await fetchUnreadCount();
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  }, [tenant, userId, fetchNotifications, fetchUnreadCount]);

  const refresh = useCallback(async () => {
    await fetchNotifications();
    await fetchUnreadCount();
  }, [fetchNotifications, fetchUnreadCount]);

  const dismissIncomingCall = useCallback(() => setIncomingCall(null), []);

  return {
    notifications,
    unreadCount,
    highUnreadCount,
    isConnected,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    refresh,
    incomingCall,
    dismissIncomingCall,
  };
}
