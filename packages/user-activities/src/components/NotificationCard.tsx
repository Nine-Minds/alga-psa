import React from 'react';

import {
  Activity,
  NotificationActivity,
  ActivityType,
  ActivityPriority
} from "@alga-psa/types";
import { useActivityDrawer } from "./ActivityDrawerProvider";
import { Badge } from "@alga-psa/ui/components/Badge";
import { ActivityActionMenu } from "./ActivityActionMenu";
import { Bell, Info, CheckCircle, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { markAsReadAction } from '@alga-psa/notifications/actions';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
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

// Per-row priority indicator dot colour (task 29.8.46). High uses a muted
// "attention red" (desaturated, not emergency); normal/low stay neutral.
const PRIORITY_DOT_COLOR: Record<string, string> = {
  [ActivityPriority.HIGH]: '#b45454',
  [ActivityPriority.MEDIUM]: '#9ca3af',
  [ActivityPriority.LOW]: '#cbd5e1',
};

// Map the activity priority onto the i18n key stem used for the row label.
const priorityLabelKey = (priority: ActivityPriority | undefined): 'high' | 'normal' | 'low' => {
  switch (priority) {
    case ActivityPriority.HIGH:
      return 'high';
    case ActivityPriority.LOW:
      return 'low';
    default:
      return 'normal';
  }
};

export function NotificationCard({ activity, onViewDetails, onActionComplete }: NotificationCardProps) {
  const { t } = useTranslation('msp/user-activities');
  const { enabled } = useFeatureFlag('release-v1-5-feature');
  const { openActivityDrawer } = useActivityDrawer();
  const notification = activity as NotificationActivity;
  const priority = notification.priority as ActivityPriority | undefined;

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

  // Flag on (task 29.8.46): ~5px corners, no colored left rail, carried by a soft
  // shadow with no border. High-tier cards add a muted attention-red ring to the
  // shadow; low-tier cards render dimmed. Flag off: original markup unchanged.
  const restyled = enabled;
  const isHigh = priority === ActivityPriority.HIGH;
  const isLow = priority === ActivityPriority.LOW;

  const restyledClassName = [
    'p-4 transition-shadow cursor-pointer',
    !notification.isRead ? 'bg-primary-50' : 'bg-white',
    isHigh ? 'shadow-md hover:shadow-lg' : 'shadow-sm hover:shadow-md',
    isLow ? 'opacity-60 hover:opacity-100' : '',
  ].filter(Boolean).join(' ');

  const restyledStyle: React.CSSProperties = {
    borderRadius: '5px',
    ...(isHigh ? { boxShadow: '0 1px 3px rgba(0,0,0,0.10), 0 0 0 1px rgba(180,84,84,0.45)' } : {}),
  };

  return (
    <div
      className={restyled
        ? restyledClassName
        : `p-4 border-l-4 ${getBorderColor(notification.status)} ${!notification.isRead ? 'bg-primary-50' : 'bg-[rgb(var(--color-card))]'} rounded-md card-elevated card-elevated-hover transition-shadow cursor-pointer`}
      style={restyled ? restyledStyle : undefined}
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
          {restyled && (
            <span className="inline-flex items-center gap-1 text-gray-600" title={t('sections.notifications.priority.label', { defaultValue: 'Priority' })}>
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: PRIORITY_DOT_COLOR[priority ?? ActivityPriority.MEDIUM] }}
              />
              {t(`sections.notifications.priority.${priorityLabelKey(priority)}`, {
                defaultValue: priorityLabelKey(priority) === 'high' ? 'High' : priorityLabelKey(priority) === 'low' ? 'Low' : 'Normal',
              })}
            </span>
          )}
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
