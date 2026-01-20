'use client';


import React, { useState } from 'react';
import { CheckCheck, RefreshCw, WifiOff, AlertCircle, Bell as BellIcon } from 'lucide-react';
import Link from 'next/link';
import Spinner from '@alga-psa/ui/components/Spinner';
import { NotificationItem } from './NotificationItem';
import type { InternalNotification } from '../types/internalNotification';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useSession } from 'next-auth/react';

interface NotificationDropdownProps {
  notifications: InternalNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  onMarkAsRead: (notificationId: string) => Promise<void>;
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
  const { data: session } = useSession();
  const tenant = useTenant();

  // Load both translation namespaces
  const { t: tClient } = useTranslation('clientPortal');
  const { t: tCommon } = useTranslation('common');

  const userType = (session?.user as any)?.user_type as 'client' | 'internal' | undefined;

  // Use appropriate translation function based on user type
  const t = userType === 'client' ? tClient : tCommon;

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

    // Determine how to handle the notification based on its type and link
    // Note: Most notifications open in a drawer first, then user can click "View Details" to navigate
    const shouldOpenInNewTab = notification.link && (
      // Tickets: category='tickets' or link pattern - open directly in new tab
      notification.category === 'tickets' ||
      notification.link.includes('/msp/tickets/') ||
      notification.link.includes('/client-portal/tickets/') ||
      // Project tasks: link pattern with /tasks/
      (notification.link.includes('/msp/projects/') && notification.link.includes('/tasks/'))
    );

    if (shouldOpenInNewTab && notification.link) {
      // Open tickets and project tasks directly in a new tab
      window.open(notification.link, '_blank', 'noopener,noreferrer');
      onClose();
      return;
    }

    // Close the dropdown and navigate to the link (if present).
    onClose();
    if (notification.link) {
      window.location.href = notification.link;
    }
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
                <Spinner size="sm" className="scale-75" />
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
            <Spinner size="md" className="text-gray-400" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <BellIcon className="w-12 h-12 text-gray-300 mb-3" />
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

      {/* Footer */}
      {userType && (
        <div className="border-t border-gray-200">
          <Link
            href={userType === 'client' ? '/client-portal/profile?tab=activity' : '/msp/user-activities'}
            onClick={onClose}
            className="flex items-center justify-center px-4 py-3 text-sm font-medium text-main-600 hover:text-main-700 hover:bg-gray-50 transition-colors"
          >
            {t('notifications.viewAll', 'View all notifications')}
          </Link>
        </div>
      )}
    </div>
  );
}
