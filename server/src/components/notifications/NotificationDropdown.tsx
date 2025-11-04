'use client';

import React, { useState } from 'react';
import { CheckCheck, RefreshCw, Loader2, WifiOff, AlertCircle } from 'lucide-react';
import { NotificationItem } from './NotificationItem';
import type { InternalNotification } from 'server/src/lib/models/internalNotification';
import { useActivityDrawer } from 'server/src/components/user-activities/ActivityDrawerProvider';
import { ActivityType, NotificationActivity } from 'server/src/interfaces/activity.interfaces';
import { useTenant } from 'server/src/components/TenantProvider';

interface NotificationDropdownProps {
  notifications: InternalNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  onMarkAsRead: (notificationId: number) => Promise<void>;
  onMarkAllAsRead: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

export function NotificationDropdown({
  notifications,
  unreadCount,
  isLoading,
  error,
  isConnected,
  onMarkAsRead,
  onMarkAllAsRead,
  onRefresh,
  onClose
}: NotificationDropdownProps) {
  const [isMarkingAllAsRead, setIsMarkingAllAsRead] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { openActivityDrawer } = useActivityDrawer();
  const tenant = useTenant();

  const handleMarkAllAsRead = async () => {
    try {
      setIsMarkingAllAsRead(true);
      await onMarkAllAsRead();
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    } finally {
      setIsMarkingAllAsRead(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await onRefresh();
    } catch (err) {
      console.error('Failed to refresh notifications:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleNotificationClick = async (notification: InternalNotification) => {
    // Mark as read if unread
    if (!notification.is_read) {
      await onMarkAsRead(notification.internal_notification_id);
    }

    // Convert InternalNotification to NotificationActivity
    // Map priority based on notification type
    let priority: any;
    switch (notification.type) {
      case 'error':
        priority = 'high';
        break;
      case 'warning':
        priority = 'medium';
        break;
      default:
        priority = 'low';
    }

    const notificationActivity: NotificationActivity = {
      id: notification.internal_notification_id.toString(),
      notificationId: notification.internal_notification_id,
      title: notification.title,
      message: notification.message,
      description: notification.message,
      type: ActivityType.NOTIFICATION,
      sourceType: ActivityType.NOTIFICATION,
      sourceId: notification.internal_notification_id.toString(),
      status: notification.type || 'info',
      priority: priority,
      isRead: notification.is_read,
      readAt: notification.read_at || undefined,
      link: notification.link || undefined,
      category: notification.category || undefined,
      templateName: notification.template_name || '',
      metadata: notification.metadata as Record<string, any>,
      assignedTo: notification.user_id ? [notification.user_id] : [],
      actions: [],
      tenant: tenant || '',
      createdAt: notification.created_at,
      updatedAt: notification.updated_at || notification.created_at
    };

    // Close the dropdown and open the notification in the drawer
    onClose();
    openActivityDrawer(notificationActivity);
  };

  return (
    <div className="flex flex-col max-h-[600px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
          {!isConnected && (
            <span className="flex items-center gap-1 text-xs text-yellow-600" title="Reconnecting to server...">
              <WifiOff className="w-3 h-3" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              disabled={isMarkingAllAsRead}
              className="flex items-center gap-1 px-2 py-1 text-xs text-main-600 hover:text-main-700 disabled:opacity-50"
              title="Mark all as read"
            >
              {isMarkingAllAsRead ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCheck className="w-3 h-3" />
              )}
              <span>Mark all read</span>
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      {(error || unreadCount > 0) && (
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
          {error ? (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* Notifications list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && notifications.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Bell className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-sm text-gray-500 font-medium">No notifications</p>
            <p className="text-xs text-gray-400 mt-1">You're all caught up!</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.internal_notification_id}
                notification={notification}
                onClick={() => handleNotificationClick(notification)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer - removed for now since all notifications are in dropdown */}
    </div>
  );
}

// Re-export Bell icon for convenience
function Bell({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
