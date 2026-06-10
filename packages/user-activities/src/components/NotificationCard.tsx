import React from 'react';

import {
  Activity,
  NotificationActivity,
  ActivityType
} from "@alga-psa/types";
import { useActivityDrawer } from "./ActivityDrawerProvider";
import { Badge } from "@alga-psa/ui/components/Badge";
import { ActivityActionMenu } from "./ActivityActionMenu";
import { Bell, Info, CheckCircle, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { markAsReadAction } from '@alga-psa/notifications/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface NotificationCardProps {
  activity: Activity;
  onViewDetails: (activity: Activity) => void;
  onActionComplete?: () => void;
}

// Get icon based on notification type
const getNotificationIcon = (type: string) => {
  switch (type) {
    case 'info':
      return <Info className="h-4 w-4 text-primary-500" />;
    case 'success':
      return <CheckCircle className="h-4 w-4 text-success" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case 'warning':
      return <AlertCircle className="h-4 w-4 text-warning" />;
    default:
      return <Bell className="h-4 w-4 text-gray-500" />;
  }
};

// Get border color based on notification type
const getBorderColor = (type: string) => {
  switch (type) {
    case 'info':
      return 'border-primary-500';
    case 'success':
      return 'border-success';
    case 'error':
      return 'border-destructive';
    case 'warning':
      return 'border-warning';
    default:
      return 'border-gray-500';
  }
};

export function NotificationCard({ activity, onViewDetails, onActionComplete }: NotificationCardProps) {
  const { t } = useTranslation('msp/user-activities');
  const { openActivityDrawer } = useActivityDrawer();
  const notification = activity as NotificationActivity;

  const handleClick = async () => {
    // Mark as read if unread
    if (!notification.isRead) {
      try {
        const userId = notification.assignedTo?.[0] ?? '';
        await markAsReadAction(notification.tenant as string, userId as string, notification.notificationId);
        // Refresh the list after marking as read
        if (onActionComplete) {
          onActionComplete();
        }
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
      }
    }

    // Open the notification in the activity drawer for all notification types
    // The NotificationDetailView handles navigation to tickets, tasks, and documents within the drawer
    openActivityDrawer(activity);
  };

  return (
    <div
      className={`p-4 border-l-4 ${getBorderColor(notification.status)} ${!notification.isRead ? 'bg-primary-50' : 'bg-white'} rounded-md shadow-sm hover:shadow-md transition-shadow cursor-pointer`}
      onClick={handleClick}
      id={`notification-card-${notification.id}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 truncate">
          {getNotificationIcon(notification.status)}
          <h3 className="font-medium text-gray-900 truncate">{notification.title}</h3>
          {!notification.isRead && (
            <div className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" title={t('table.values.unread', { defaultValue: 'Unread' })} />
          )}
        </div>
        <div className="flex items-center gap-2">
          <div onClick={(e) => e.stopPropagation()}>
            <ActivityActionMenu
              activity={activity}
              onActionComplete={onActionComplete}
              onViewDetails={onViewDetails}
            />
          </div>
        </div>
      </div>

      <div className="mb-3 text-sm text-gray-500 line-clamp-2">
        {notification.message || notification.description || t('card.noMessage', { defaultValue: 'No message' })}
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          {notification.category && (
            <Badge variant="default">{notification.category}</Badge>
          )}
          {notification.createdAt && (() => {
            try {
              const date = new Date(notification.createdAt);
              // Check if date is valid
              if (isNaN(date.getTime())) {
                console.warn('Invalid date for notification:', notification.createdAt);
                return null;
              }
              return (
                <span className="text-gray-500">
                  {formatDistanceToNow(date, { addSuffix: true })}
                </span>
              );
            } catch (error) {
              console.error('Error formatting date:', error, notification.createdAt);
              return null;
            }
          })()}
        </div>
      </div>
    </div>
  );
}
