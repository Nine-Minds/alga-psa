'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useSSE } from './useSSE';
import toast from 'react-hot-toast';
import { Notification } from 'server/src/interfaces/notification.interfaces';
import { getNotificationsAction, getUnreadNotificationCountAction } from 'server/src/lib/actions/notification-actions/inAppNotificationActions';

export function useNotifications() {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Load initial notifications
  useEffect(() => {
    if (session?.user) {
      loadInitialData();
    }
  }, [session]);

  const loadInitialData = async () => {
    try {
      setIsLoading(true);
      const [notificationsResult, count] = await Promise.all([
        getNotificationsAction(1, 20), // First 20 notifications
        getUnreadNotificationCountAction()
      ]);
      
      setNotifications(notificationsResult.notifications);
      setUnreadCount(count);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSSEMessage = useCallback((event: MessageEvent) => {
    try {
      const eventType = event.type || 'message';
      let data;
      
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        console.error('Failed to parse SSE message:', e);
        return;
      }

      switch (eventType) {
        case 'notification':
          // Add new notification to the beginning of the list
          setNotifications(prev => {
            // Avoid duplicates
            if (prev.some(n => n.internal_notification_id === data.internal_notification_id)) {
              return prev;
            }
            return [data, ...prev];
          });
          setUnreadCount(prev => prev + 1);
          
          // Show toast for high priority notifications
          if (data.priority_name === 'high' || data.priority_name === 'urgent') {
            toast.error(data.message || data.title);
          } else {
            // Show regular toast for normal notifications
            toast.success(data.message || data.title);
          }
          break;

        case 'initial-notifications':
          // Set initial notifications from SSE (in case we missed any)
          if (Array.isArray(data)) {
            setNotifications(data);
            setUnreadCount(data.filter((n: Notification) => !n.read_at).length);
          }
          break;

        case 'notification-read':
          // Update read status
          if (data.internal_notification_id) {
            setNotifications(prev =>
              prev.map(n => n.internal_notification_id === data.internal_notification_id ? { ...n, read_at: data.read_at } : n)
            );
            setUnreadCount(prev => Math.max(0, prev - 1));
          }
          break;

        case 'connected':
          console.log('SSE connected for notifications');
          break;

        case 'heartbeat':
          // SSE heartbeat, do nothing
          break;

        default:
          console.log('Unknown SSE event type:', eventType, data);
      }
    } catch (error) {
      console.error('Error handling SSE message:', error);
    }
  }, []);

  const { connectionState } = useSSE({
    endpoint: '/api/notifications/sse',
    onMessage: handleSSEMessage,
    onError: (error) => {
      console.error('Notification SSE error:', error);
    },
    onOpen: () => {
      console.log('Notification SSE connection opened');
    }
  });

  return {
    notifications,
    unreadCount,
    connectionState,
    isLoading,
    refreshNotifications: loadInitialData,
  };
}