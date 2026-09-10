'use client';

import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, Bell, CheckCircle, Info } from 'lucide-react';
import { markAsReadAction } from '@alga-psa/notifications/actions';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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

// Configurable notification priorities (task 29.8.46). Muted attention-red for
// high; low renders dimmed. activity.priority is ActivityPriority.
const PRIORITY_INDICATOR: Record<string, { label: string; dot: string }> = {
  high: { label: 'High', dot: 'bg-rose-500' },
  medium: { label: 'Normal', dot: 'bg-gray-400' },
  low: { label: 'Low', dot: 'bg-gray-300' },
};

export function ClientNotificationCard({
  activity,
  onActionComplete,
  onOpen,
}: ClientNotificationCardProps) {
  const { t } = useTranslation('client-portal');
  // Priority ring/dim + indicator (task 29.8.46).
  const priorityCardClass = activity.priority === 'high'
    ? ' ring-1 ring-rose-400'
    : activity.priority === 'low'
      ? ' opacity-70'
      : '';
  const priorityIndicator = PRIORITY_INDICATOR[activity.priority];

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
      className={`w-full rounded-md border-l-4 p-4 text-left transition-shadow card-elevated card-elevated-hover ${getBorderColor(activity.status)} ${activity.isRead ? 'bg-[rgb(var(--color-card))]' : 'bg-primary-50'}${priorityCardClass}`}
      onClick={handleClick}
      id={`notification-card-${activity.id}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2 truncate">
          {getNotificationIcon(activity.status)}
          <h3 className="truncate font-medium text-gray-900">{activity.title}</h3>
          {!activity.isRead ? (
            <div className="h-2 w-2 flex-shrink-0 rounded-full bg-primary-500" title={t('notifications.card.unread', { defaultValue: 'Unread' })} />
          ) : null}
        </div>
      </div>

      <div className="mb-3 line-clamp-2 text-sm text-gray-500">
        {activity.message || activity.description || t('notifications.card.noMessage', { defaultValue: 'No message' })}
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          {priorityIndicator ? (
            <span className="flex items-center gap-1 text-gray-500" title={`Priority: ${priorityIndicator.label}`}>
              <span className={`h-2 w-2 rounded-full ${priorityIndicator.dot}`} />
              {priorityIndicator.label}
            </span>
          ) : null}
          {activity.category ? <Badge variant="default">{activity.category}</Badge> : null}
          {hasValidCreatedAt ? (
            <span className="text-gray-500">{formatDistanceToNow(createdAt, { addSuffix: true })}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
