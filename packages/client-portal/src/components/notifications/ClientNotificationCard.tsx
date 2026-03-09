'use client';

import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, Bell, CheckCircle, Info } from 'lucide-react';
import { markAsReadAction } from '@alga-psa/notifications/actions';
import { Badge } from '@alga-psa/ui/components/Badge';
import type { NotificationActivity } from '@alga-psa/types';

interface ClientNotificationCardProps {
  activity: NotificationActivity;
  onActionComplete?: () => void;
  onOpen: (activity: NotificationActivity) => void;
}

function getNotificationIcon(type: string) {
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
}

function getBorderColor(type: string) {
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
}

export function ClientNotificationCard({
  activity,
  onActionComplete,
  onOpen,
}: ClientNotificationCardProps) {
  const handleClick = async () => {
    if (!activity.isRead) {
      try {
        const tenantId = activity.tenant ?? '';
        const userId = activity.assignedTo?.[0] ?? '';
        if (tenantId) {
          await markAsReadAction(tenantId, userId, activity.notificationId);
          onActionComplete?.();
        }
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
      }
    }

    onOpen(activity);
  };

  const createdAt = new Date(activity.createdAt);
  const hasValidCreatedAt = !Number.isNaN(createdAt.getTime());

  return (
    <button
      type="button"
      className={`w-full rounded-md border-l-4 p-4 text-left shadow-sm transition-shadow hover:shadow-md ${getBorderColor(activity.status)} ${activity.isRead ? 'bg-white' : 'bg-primary-50'}`}
      onClick={handleClick}
      id={`notification-card-${activity.id}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2 truncate">
          {getNotificationIcon(activity.status)}
          <h3 className="truncate font-medium text-gray-900">{activity.title}</h3>
          {!activity.isRead ? (
            <div className="h-2 w-2 flex-shrink-0 rounded-full bg-primary-500" title="Unread" />
          ) : null}
        </div>
      </div>

      <div className="mb-3 line-clamp-2 text-sm text-gray-500">
        {activity.message || activity.description || 'No message'}
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          {activity.category ? <Badge variant="default">{activity.category}</Badge> : null}
          {hasValidCreatedAt ? (
            <span className="text-gray-500">{formatDistanceToNow(createdAt, { addSuffix: true })}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
