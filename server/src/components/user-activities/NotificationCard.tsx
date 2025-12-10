import React from 'react';
import {
  Activity,
  NotificationActivity,
  ActivityType
} from "server/src/interfaces/activity.interfaces";
import { useActivityDrawer } from "server/src/components/user-activities/ActivityDrawerProvider";
import { Badge } from "server/src/components/ui/Badge";
import { ActivityActionMenu } from "server/src/components/user-activities/ActivityActionMenu";
import { Bell, Info, CheckCircle, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { markAsReadAction } from 'server/src/lib/actions/internal-notification-actions/internalNotificationActions';

interface NotificationCardProps {
  activity: Activity;
  onViewDetails: (activity: Activity) => void;
  onActionComplete?: () => void;
}

// Get icon based on notification type
const getNotificationIcon = (type: string) => {
  switch (type) {
    case 'info':
      return <Info className="h-4 w-4 text-blue-500" />;
    case 'success':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case 'warning':
      return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    default:
      return <Bell className="h-4 w-4 text-gray-500" />;
  }
};

// Get border color based on notification type
const getBorderColor = (type: string) => {
  switch (type) {
    case 'info':
      return 'border-blue-500';
    case 'success':
      return 'border-green-500';
    case 'error':
      return 'border-red-500';
    case 'warning':
      return 'border-yellow-500';
    default:
      return 'border-gray-500';
  }
};

export function NotificationCard({ activity, onViewDetails, onActionComplete }: NotificationCardProps) {
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

    // Determine how to handle the notification based on its type and link
    const shouldOpenInNewTab = notification.link && (
      // Tickets: category='tickets' or link pattern
      notification.category === 'tickets' ||
      notification.link.includes('/msp/tickets/') ||
      notification.link.includes('/client-portal/tickets/') ||
      // Project tasks: link pattern with /tasks/
      (notification.link.includes('/msp/projects/') && notification.link.includes('/tasks/'))
    );

    if (shouldOpenInNewTab && notification.link) {
      // Open tickets and project tasks directly in a new tab
      window.open(notification.link, '_blank', 'noopener,noreferrer');
      return;
    }

    // For documents and other notifications, open the drawer to show details
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
            <div className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" title="Unread" />
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
        {notification.message || notification.description || 'No message'}
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
