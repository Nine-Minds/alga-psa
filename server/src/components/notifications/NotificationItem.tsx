'use client';

import { useState, useTransition } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { 
  X, 
  ExternalLink, 
  Ticket, 
  FolderOpen, 
  FileText, 
  Clock, 
  DollarSign, 
  AlertTriangle,
  CheckCircle,
  MessageSquare,
  Settings,
  Archive
} from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { markNotificationReadAction, archiveNotificationAction } from 'server/src/lib/actions/notification-actions/inAppNotificationActions';
import { Notification } from 'server/src/interfaces/notification.interfaces';
import { cn } from 'server/src/lib/utils';

interface NotificationItemProps {
  notification: Notification;
  onClose: () => void;
}

const getNotificationIcon = (typeName: string, categoryName: string) => {
  const iconClass = "h-4 w-4";
  
  if (categoryName.toLowerCase().includes('ticket')) {
    return <Ticket className={iconClass} />;
  }
  if (categoryName.toLowerCase().includes('project')) {
    return <FolderOpen className={iconClass} />;
  }
  if (categoryName.toLowerCase().includes('invoice') || categoryName.toLowerCase().includes('billing')) {
    return <DollarSign className={iconClass} />;
  }
  if (categoryName.toLowerCase().includes('time')) {
    return <Clock className={iconClass} />;
  }
  if (typeName.toLowerCase().includes('message') || typeName.toLowerCase().includes('mention')) {
    return <MessageSquare className={iconClass} />;
  }
  if (typeName.toLowerCase().includes('sla') || typeName.toLowerCase().includes('escalat')) {
    return <AlertTriangle className={iconClass} />;
  }
  if (typeName.toLowerCase().includes('approved') || typeName.toLowerCase().includes('completed')) {
    return <CheckCircle className={iconClass} />;
  }
  if (categoryName.toLowerCase().includes('document')) {
    return <FileText className={iconClass} />;
  }
  
  return <Settings className={iconClass} />;
};

const renderRichContent = (notification: Notification) => {
  const data = notification.data || {};
  
  // Ticket-related content
  if (notification.category_name.toLowerCase().includes('ticket') && data.ticket_number) {
    return (
      <div className="mt-2 p-2 bg-gray-50 rounded-md">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">#{data.ticket_number}</span>
          {data.ticket_title && (
            <>
              <span className="text-gray-400">•</span>
              <span className="text-gray-600 truncate">{data.ticket_title}</span>
            </>
          )}
        </div>
        {data.new_status && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xs text-gray-500">Status:</span>
            <Badge variant="outline" className="text-xs">{data.new_status}</Badge>
          </div>
        )}
        {data.old_priority && data.new_priority && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xs text-gray-500">Priority:</span>
            <span className="text-xs text-red-600">{data.old_priority} → {data.new_priority}</span>
          </div>
        )}
      </div>
    );
  }
  
  // Project-related content
  if (notification.category_name.toLowerCase().includes('project') && (data.project_name || data.project_id)) {
    return (
      <div className="mt-2 p-2 bg-gray-50 rounded-md">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{data.project_name || `Project #${data.project_id}`}</span>
        </div>
        {data.task_title && (
          <div className="text-xs text-gray-600 mt-1">Task: {data.task_title}</div>
        )}
      </div>
    );
  }
  
  // Invoice-related content
  if (notification.category_name.toLowerCase().includes('invoice') && (data.invoice_number || data.amount)) {
    return (
      <div className="mt-2 p-2 bg-gray-50 rounded-md">
        <div className="flex items-center justify-between text-sm">
          {data.invoice_number && (
            <span className="font-medium">Invoice #{data.invoice_number}</span>
          )}
          {data.amount && (
            <span className="font-medium text-green-600">${data.amount}</span>
          )}
        </div>
        {data.client_name && (
          <div className="text-xs text-gray-600 mt-1">Client: {data.client_name}</div>
        )}
      </div>
    );
  }
  
  // Time entry related content
  if (notification.category_name.toLowerCase().includes('time') && data.hours) {
    return (
      <div className="mt-2 p-2 bg-gray-50 rounded-md">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{data.hours} hours</span>
          {data.date && (
            <>
              <span className="text-gray-400">•</span>
              <span className="text-gray-600">{data.date}</span>
            </>
          )}
        </div>
        {data.description && (
          <div className="text-xs text-gray-600 mt-1 truncate">{data.description}</div>
        )}
      </div>
    );
  }
  
  return null;
};

const getActionButtons = (notification: Notification) => {
  const data = notification.data || {};
  const actions = [];
  
  // Primary action - View
  if (notification.action_url) {
    actions.push({
      label: "View",
      variant: "outline" as const,
      icon: <ExternalLink className="h-3 w-3" />,
      onClick: () => window.location.href = notification.action_url!
    });
  }
  
  // Time entry approval actions
  if (notification.type_name === 'TIME_ENTRY_SUBMITTED' && data.time_entry_id) {
    actions.push({
      label: "Approve",
      variant: "default" as const,
      icon: <CheckCircle className="h-3 w-3" />,
      onClick: () => {
        // TODO: Implement time entry approval action
        console.log('Approve time entry:', data.time_entry_id);
      }
    });
  }
  
  // Ticket assignment actions
  if (notification.type_name === 'TICKET_ASSIGNED' && data.ticket_id) {
    actions.push({
      label: "Accept",
      variant: "default" as const,
      icon: <CheckCircle className="h-3 w-3" />,
      onClick: () => {
        // TODO: Implement ticket acceptance action
        console.log('Accept ticket:', data.ticket_id);
      }
    });
  }
  
  return actions;
};

export function NotificationItem({ notification, onClose }: NotificationItemProps) {
  const [isPending, startTransition] = useTransition();
  const [isRead, setIsRead] = useState(!!notification.read_at);
  const [isArchived, setIsArchived] = useState(false);


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

  const actionButtons = getActionButtons(notification);
  const richContent = renderRichContent(notification);

  return (
    <div
      className={cn(
        'p-4 hover:bg-gray-50 transition-colors relative border-b border-gray-100',
        !isRead && 'bg-blue-50 border-l-4 border-l-blue-500'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon and Priority indicator */}
        <div className="flex flex-col items-center gap-2 flex-shrink-0">
          <div className="p-2 rounded-full bg-gray-100">
            {getNotificationIcon(notification.type_name, notification.category_name)}
          </div>
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              getPriorityColor(notification.priority_name)
            )}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h5 className={cn(
                  'font-medium text-sm leading-tight',
                  !isRead && 'font-semibold'
                )}>
                  {notification.title}
                </h5>
                
                {notification.priority_name && notification.priority_name.toLowerCase() !== 'normal' && (
                  <Badge 
                    variant={getPriorityVariant(notification.priority_name)}
                    className="text-xs"
                  >
                    {notification.priority_name}
                  </Badge>
                )}
              </div>
              
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-xs">
                  {notification.category_name}
                </Badge>
                <span className="text-xs text-gray-500">
                  {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                </span>
              </div>
            </div>
            
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

          {notification.message && (
            <p className="text-sm text-gray-600 mb-2 line-clamp-2">
              {notification.message}
            </p>
          )}

          {/* Rich content preview */}
          {richContent}

          {/* Action buttons */}
          {actionButtons.length > 0 && (
            <div className="flex items-center gap-2 mt-3">
              {actionButtons.map((action, index) => (
                <Button
                  key={index}
                  variant={action.variant}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
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
                    action.onClick();
                  }}
                >
                  {action.icon}
                  <span className="ml-1">{action.label}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Unread indicator */}
      {!isRead && (
        <div className="absolute right-2 top-2 w-2 h-2 bg-blue-500 rounded-full" />
      )}
    </div>
  );
}