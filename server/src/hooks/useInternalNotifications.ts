"use client"

import { useState, useEffect, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  InternalNotification,
  InternalNotificationListResponse,
  UnreadCountResponse
} from '../lib/models/internalNotification';
import {
  getNotificationsAction,
  getUnreadCountAction,
  markAsReadAction,
  markAllAsReadAction
} from '../lib/actions/internal-notification-actions/internalNotificationActions';

const HOCUSPOCUS_URL = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL || 'ws://localhost:1234';
const POLLING_INTERVAL = 30000; // 30 seconds
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const INITIAL_RECONNECT_DELAY = 1000; // 1 second

interface UseInternalNotificationsOptions {
  tenant: string;
  userId: string;
  limit?: number;
  enablePolling?: boolean; // Fallback to polling when disconnected
}

interface UseInternalNotificationsReturn {
  notifications: InternalNotification[];
  unreadCount: number;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  markAsRead: (notificationId: number) => Promise<void>;
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

  // Fetch notifications from REST API
  const fetchNotifications = useCallback(async () => {
    try {
      const response: InternalNotificationListResponse = await getNotificationsAction({
        tenant,
        user_id: userId,
        limit
      });
      setNotifications(response.notifications);
      setUnreadCount(response.unread_count);
      setError(null);

      // Update Y.js document with fetched data if connected
      if (ydocRef.current && providerRef.current?.status === 'connected') {
        const notificationsMap = ydocRef.current.getMap('notifications');
        const unreadCountMap = ydocRef.current.getMap('unreadCount');

        // Always update with fresh data from API to ensure consistency
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

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    try {
      const response: UnreadCountResponse = await getUnreadCountAction(tenant, userId);
      setUnreadCount(response.unread_count);
    } catch (err) {
      console.error('Failed to fetch unread count:', err);
    }
  }, [tenant, userId]);

  // Setup Y.js WebSocket connection
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
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY; // Reset delay on successful connection

        // Stop polling when connected
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }

        // Fetch initial data
        fetchNotifications();
      },

      onDisconnect: ({ event }) => {
        console.log('Disconnected from notification stream', event);
        setIsConnected(false);

        // Start polling as fallback when disconnected
        if (enablePolling && !pollingIntervalRef.current) {
          pollingIntervalRef.current = setInterval(fetchNotifications, POLLING_INTERVAL);
        }

        // Attempt reconnection with exponential backoff
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log(`Attempting to reconnect in ${reconnectDelayRef.current}ms...`);
          provider.connect();
          reconnectDelayRef.current = Math.min(
            reconnectDelayRef.current * 2,
            MAX_RECONNECT_DELAY
          );
        }, reconnectDelayRef.current);
      },

      onDestroy: () => {
        console.log('Notification provider destroyed');
        setIsConnected(false);
      }
    });

    providerRef.current = provider;
    ydocRef.current = ydoc;

    // Setup Y.Map for notifications
    const notificationsMap = ydoc.getMap('notifications');
    const unreadCountMap = ydoc.getMap('unreadCount');

    // Listen for notification updates
    notificationsMap.observe(() => {
      const notifData = notificationsMap.get('data');
      if (notifData) {
        setNotifications(notifData as InternalNotification[]);
      }
    });

    // Listen for unread count updates
    unreadCountMap.observe(() => {
      const count = unreadCountMap.get('count');
      if (typeof count === 'number') {
        setUnreadCount(count);
      }
    });

    // Initial load
    fetchNotifications();
  }, [tenant, userId, fetchNotifications, enablePolling]);

  // Mark notification as read
  const markAsRead = useCallback(async (notificationId: number) => {
    try {
      await markAsReadAction(tenant, userId, notificationId);

      // Update local state optimistically
      setNotifications(prev =>
        prev.map(n =>
          n.internal_notification_id === notificationId
            ? { ...n, is_read: true, read_at: new Date().toISOString() }
            : n
        )
      );
      setUnreadCount(prev => Math.max(0, prev - 1));

      // Broadcast update via Y.js if connected
      if (providerRef.current && ydocRef.current) {
        const notificationsMap = ydocRef.current.getMap('notifications');
        const updatedNotifications = notifications.map(n =>
          n.internal_notification_id === notificationId
            ? { ...n, is_read: true, read_at: new Date().toISOString() }
            : n
        );
        notificationsMap.set('data', updatedNotifications);

        const unreadCountMap = ydocRef.current.getMap('unreadCount');
        unreadCountMap.set('count', unreadCount - 1);
      }
    } catch (err) {
      console.error('Failed to mark as read:', err);
      throw err;
    }
  }, [tenant, userId, notifications, unreadCount]);

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    try {
      await markAllAsReadAction(tenant, userId);

      // Update local state
      setNotifications(prev =>
        prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
      );
      setUnreadCount(0);

      // Broadcast update via Y.js if connected
      if (providerRef.current && ydocRef.current) {
        const notificationsMap = ydocRef.current.getMap('notifications');
        const updatedNotifications = notifications.map(n => ({
          ...n,
          is_read: true,
          read_at: new Date().toISOString()
        }));
        notificationsMap.set('data', updatedNotifications);

        const unreadCountMap = ydocRef.current.getMap('unreadCount');
        unreadCountMap.set('count', 0);
      }
    } catch (err) {
      console.error('Failed to mark all as read:', err);
      throw err;
    }
  }, [tenant, userId, notifications]);

  // Refresh notifications manually
  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchNotifications();
  }, [fetchNotifications]);

  // Setup on mount
  useEffect(() => {
    setupWebSocket();

    // Cleanup on unmount
    return () => {
      if (providerRef.current) {
        providerRef.current.destroy();
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [setupWebSocket]);

  return {
    notifications,
    unreadCount,
    isConnected,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    refresh
  };
}
