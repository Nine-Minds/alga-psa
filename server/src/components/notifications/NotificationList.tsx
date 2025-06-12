'use client';

import { NotificationItem } from './NotificationItem';
import { Button } from 'server/src/components/ui/Button';
import { markAllNotificationsReadAction } from 'server/src/lib/actions/notification-actions/inAppNotificationActions';
import { Notification } from 'server/src/interfaces/notification.interfaces';
import { useState, useTransition } from 'react';
import { Bell } from 'lucide-react';

interface NotificationListProps {
  notifications: Notification[];
  onClose: () => void;
}

export function NotificationList({ notifications, onClose }: NotificationListProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticNotifications, setOptimisticNotifications] = useState(notifications);

  const handleMarkAllRead = () => {
    // Optimistic update
    setOptimisticNotifications(prev => 
      prev.map(notification => ({
        ...notification,
        read_at: notification.read_at ? notification.read_at : new Date()
      }))
    );

    startTransition(async () => {
      try {
        await markAllNotificationsReadAction();
      } catch (error) {
        console.error('Failed to mark all notifications as read:', error);
        // Revert optimistic update on error
        setOptimisticNotifications(notifications);
      }
    });
  };

  const unreadCount = optimisticNotifications.filter(n => !n.read_at).length;

  if (optimisticNotifications.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Bell className="h-12 w-12 mx-auto mb-4 text-gray-300" />
        <p>No notifications yet</p>
        <p className="text-sm">You'll see new notifications here</p>
      </div>
    );
  }

  return (
    <div className="max-h-96">
      {unreadCount > 0 && (
        <div className="p-3 border-b bg-gray-50">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={isPending}
            className="w-full"
          >
            {isPending ? 'Marking all read...' : `Mark all ${unreadCount} as read`}
          </Button>
        </div>
      )}
      
      <div className="max-h-80 overflow-y-auto">
        <div className="divide-y">
          {optimisticNotifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onClose={onClose}
            />
          ))}
        </div>
      </div>

      <div className="p-3 border-t bg-gray-50">
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => {
            onClose();
            // Navigate to full notifications page
            window.location.href = '/msp/notifications';
          }}
        >
          View all notifications
        </Button>
      </div>
    </div>
  );
}