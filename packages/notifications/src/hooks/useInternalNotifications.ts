// @ts-nocheck
// TODO: Action argument count issues
"use client";


import { useState, useEffect, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
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
} from '@alga-psa/notifications/actions';

const getHocuspocusUrl = () => {
  if (typeof window === 'undefined') {
    return 'ws://localhost:1234';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;

  if (!host.includes('localhost')) {
    return `${protocol}//${host}/hocuspocus`;
  }

  return process.env.NEXT_PUBLIC_HOCUSPOCUS_URL || 'ws://localhost:1234';
};

const HOCUSPOCUS_URL = getHocuspocusUrl();
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
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useInternalNotifications(
  options: UseInternalNotificationsOptions
): UseInternalNotificationsReturn {
  const { tenant, userId, limit = 20, enablePolling = true } = options;

  const [notifications, setNotifications] = useState<InternalNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const providerRef = useRef<HocuspocusProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef<number>(INITIAL_RECONNECT_DELAY);

  const fetchNotificationsRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const enablePollingRef = useRef<boolean>(enablePolling);

  const fetchNotifications = useCallback(async () => {
    try {
      const response: InternalNotificationListResponse = await getNotificationsAction({
        tenant,
        user_id: userId,
        limit,
      });
      setNotifications(response.notifications);
      setUnreadCount(response.unread_count);
      setError(null);

      if (ydocRef.current && providerRef.current?.status === 'connected') {
        const notificationsMap = ydocRef.current.getMap('notifications');
        const unreadCountMap = ydocRef.current.getMap('unreadCount');

        notificationsMap.set('data', response.notifications);
        unreadCountMap.set('count', response.unread_count);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      setError('Failed to load notifications');
    } finally {
      setIsLoading(false);
    }
  }, [tenant, userId, limit]);

  useEffect(() => {
    fetchNotificationsRef.current = fetchNotifications;
  }, [fetchNotifications]);

  useEffect(() => {
    enablePollingRef.current = enablePolling;
  }, [enablePolling]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response: UnreadCountResponse = await getUnreadCountAction(tenant, userId);
      setUnreadCount(response.unread_count);
    } catch (err) {
      console.error('Failed to fetch unread count:', err);
    }
  }, [tenant, userId]);

  const setupWebSocket = useCallback(() => {
    const roomName = `notifications:${tenant}:${userId}`;
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: HOCUSPOCUS_URL,
      name: roomName,
      document: ydoc,

      onConnect: () => {
        console.log('Connected to notification stream');
        setIsConnected(true);
        setError(null);
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;

        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }

        fetchNotificationsRef.current?.();
      },

      onDisconnect: ({ event }) => {
        console.log('Disconnected from notification stream', event);
        setIsConnected(false);

        if (enablePollingRef.current && !pollingIntervalRef.current) {
          pollingIntervalRef.current = setInterval(() => {
            fetchNotificationsRef.current?.();
          }, POLLING_INTERVAL);
        }

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
        setNotifications(notifData as InternalNotification[]);
      }
    });

    unreadCountMap.observe(() => {
      const count = unreadCountMap.get('count');
      if (typeof count === 'number') {
        setUnreadCount(count);
      }
    });

    return () => {
      provider.destroy();
      ydoc.destroy();
    };
  }, [tenant, userId]);

  useEffect(() => {
    setIsLoading(true);
    fetchNotifications();

    const cleanup = setupWebSocket();

    return () => {
      cleanup();
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [fetchNotifications, setupWebSocket]);

  const markAsRead = useCallback(
    async (notificationId: string) => {
      try {
        await markAsReadAction({
          tenant,
          user_id: userId,
          notification_id: notificationId,
        });
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
      await markAllAsReadAction({
        tenant,
        user_id: userId,
      });
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

  return {
    notifications,
    unreadCount,
    isConnected,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    refresh,
  };
}
