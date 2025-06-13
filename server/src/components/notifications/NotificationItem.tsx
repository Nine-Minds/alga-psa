'use client';

import { useState, useTransition } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { X, ExternalLink } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { markNotificationReadAction, archiveNotificationAction } from 'server/src/lib/actions/notification-actions/inAppNotificationActions';
import { Notification } from 'server/src/interfaces/notification.interfaces';
import { cn } from 'server/src/lib/utils';

interface NotificationItemProps {
  notification: Notification;
  onClose: () => void;
}

export function NotificationItem({ notification, onClose }: NotificationItemProps) {
  const [isPending, startTransition] = useTransition();
  const [isRead, setIsRead] = useState(!!notification.read_at);
  const [isArchived, setIsArchived] = useState(false);

  const handleClick = () => {
    if (!isRead) {
      setIsRead(true);
      startTransition(async () => {
        try {
          await markNotificationReadAction(notification.internal_notification_id);
        } catch (error) {
          console.error('Failed to mark notification as read:', error);
          setIsRead(false);
        }
      });
    }

    if (notification.action_url) {
      onClose();
      window.location.href = notification.action_url;
    }
  };

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsArchived(true);
    
    startTransition(async () => {
      try {
        await archiveNotificationAction(notification.internal_notification_id);
      } catch (error) {
        console.error('Failed to archive notification:', error);
        setIsArchived(false);
      }
    });
  };

  const getPriorityColor = (priority?: string) => {
    if (!priority) return 'bg-blue-500';
    switch (priority.toLowerCase()) {
      case 'urgent':
        return 'bg-red-500';
      case 'high':
        return 'bg-orange-500';
      case 'normal':
        return 'bg-blue-500';
      case 'low':
        return 'bg-gray-500';
      default:
        return 'bg-blue-500';
    }
  };

  const getPriorityVariant = (priority?: string) => {
    if (!priority) return 'outline';
    switch (priority.toLowerCase()) {
      case 'urgent':
        return 'destructive';
      case 'high':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  if (isArchived) {
    return null; // Component will be removed from the list
  }

  return (
    <div
      className={cn(
        'p-4 hover:bg-gray-50 cursor-pointer transition-colors relative',
        !isRead && 'bg-blue-50 border-l-4 border-l-blue-500'
      )}
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        {/* Priority indicator */}
        <div
          className={cn(
            'w-2 h-2 rounded-full mt-2 flex-shrink-0',
            getPriorityColor(notification.priority_name)
          )}
        />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h5 className={cn(
              'font-medium text-sm leading-tight',
              !isRead && 'font-semibold'
            )}>
              {notification.title}
            </h5>
            
            <div className="flex items-center gap-1 flex-shrink-0">
              {notification.priority_name && notification.priority_name.toLowerCase() !== 'normal' && (
                <Badge 
                  variant={getPriorityVariant(notification.priority_name)}
                  className="text-xs"
                >
                  {notification.priority_name}
                </Badge>
              )}
              
              <Button
                id={`archive-notification-${notification.internal_notification_id}`}
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-50 hover:opacity-100"
                onClick={handleArchive}
                disabled={isPending}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {notification.message && (
            <p className="text-sm text-gray-600 mt-1 line-clamp-2">
              {notification.message}
            </p>
          )}

          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-500">
              {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
            </span>
            
            {notification.action_url && (
              <div className="flex items-center gap-1 text-xs text-blue-600">
                <ExternalLink className="h-3 w-3" />
                <span>View</span>
              </div>
            )}
          </div>

          {/* Category/Type badge */}
          <div className="mt-2">
            <Badge variant="outline" className="text-xs">
              {notification.category_name}
            </Badge>
          </div>
        </div>
      </div>

      {/* Unread indicator */}
      {!isRead && (
        <div className="absolute right-2 top-2 w-2 h-2 bg-blue-500 rounded-full" />
      )}
    </div>
  );
}