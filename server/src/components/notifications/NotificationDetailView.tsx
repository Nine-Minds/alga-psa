'use client';

import React from 'react';
import { NotificationActivity } from "server/src/interfaces/activity.interfaces";
import { Button } from "server/src/components/ui/Button";
import { Badge } from "server/src/components/ui/Badge";
import {
  Info,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  Calendar,
  Tag,
  ArrowRight,
  X
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';

interface NotificationDetailViewProps {
  notification: NotificationActivity;
  onClose?: () => void;
  onNavigateToDocument?: (documentId: string, documentName: string) => void;
  onNavigateToTicket?: (ticketId: string) => void;
  onNavigateToProjectTask?: (taskId: string, projectId: string) => void;
}

// Get icon and color based on notification type
const getNotificationStyle = (type: string) => {
  switch (type) {
    case 'info':
      return {
        icon: <Info className="h-6 w-6" />,
        iconColor: 'text-blue-500',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200'
      };
    case 'success':
      return {
        icon: <CheckCircle className="h-6 w-6" />,
        iconColor: 'text-green-500',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200'
      };
    case 'error':
      return {
        icon: <AlertCircle className="h-6 w-6" />,
        iconColor: 'text-red-500',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200'
      };
    case 'warning':
      return {
        icon: <AlertTriangle className="h-6 w-6" />,
        iconColor: 'text-yellow-500',
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200'
      };
    default:
      return {
        icon: <Info className="h-6 w-6" />,
        iconColor: 'text-gray-500',
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200'
      };
  }
};

// Render priority with color indicator
const renderPriority = (name: string, color?: string) => {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0"
        style={{ backgroundColor: color || '#6B7280' }}
      />
      <span className="font-medium text-sm">{name}</span>
    </div>
  );
};

export function NotificationDetailView({ notification, onClose, onNavigateToDocument, onNavigateToTicket, onNavigateToProjectTask }: NotificationDetailViewProps) {
  const router = useRouter();
  const style = getNotificationStyle(notification.status);

  const handleNavigateToEntity = () => {
    if (notification.link) {
      // Check entity type from link
      const isDocumentLink = notification.link.includes('/msp/documents');
      const isMspTicketLink = notification.link.includes('/msp/tickets/');
      const isClientPortalTicketLink = notification.link.includes('/client-portal/tickets/');
      const isProjectTaskLink = notification.link.includes('/msp/projects/') && notification.link.includes('/tasks/');

      if (isDocumentLink) {
        // Extract document ID from URL (format: /msp/documents?doc=<documentId>)
        const url = new URL(notification.link, window.location.origin);
        const documentId = url.searchParams.get('doc');

        if (documentId && onNavigateToDocument) {
          // Get document name from metadata if available
          const documentName = notification.metadata?.documentName || 'Document';
          // Use the callback to open the document
          onNavigateToDocument(documentId, documentName);
        }
      } else if (isClientPortalTicketLink) {
        // For client portal tickets, navigate to the dedicated ticket page
        // Extract ticket ID from URL (format: /client-portal/tickets/<ticketId>)
        const ticketId = notification.metadata?.ticketId || notification.link.split('/client-portal/tickets/')[1]?.split('?')[0]?.split('#')[0];
        if (ticketId) {
          router.push(`/client-portal/tickets/${ticketId}`);
          // Close the drawer after navigation
          if (onClose) {
            onClose();
          }
        }
      } else if (isMspTicketLink && onNavigateToTicket) {
        // For MSP tickets, use the callback to open in drawer
        // Extract ticket ID from URL (format: /msp/tickets/<ticketId>)
        const ticketId = notification.metadata?.ticketId || notification.link.split('/msp/tickets/')[1]?.split('?')[0]?.split('#')[0];
        if (ticketId) {
          onNavigateToTicket(ticketId);
        }
      } else if (isProjectTaskLink && onNavigateToProjectTask) {
        // Extract project ID and task ID from metadata or URL
        let taskId = notification.metadata?.taskId;
        let projectId = notification.metadata?.projectId;

        // If not in metadata, try to extract from URL (format: /msp/projects/<projectId>/tasks/<taskId>)
        if (!taskId || !projectId) {
          const urlParts = notification.link.split('/');
          const projectIndex = urlParts.indexOf('projects');
          const taskIndex = urlParts.indexOf('tasks');

          if (projectIndex !== -1 && projectIndex + 1 < urlParts.length) {
            projectId = urlParts[projectIndex + 1];
          }
          if (taskIndex !== -1 && taskIndex + 1 < urlParts.length) {
            taskId = urlParts[taskIndex + 1];
          }
        }

        if (taskId && projectId) {
          onNavigateToProjectTask(taskId, projectId);
        }
      } else {
        // For other links, navigate normally and close drawer
        router.push(notification.link);
        // Close the drawer after navigation
        if (onClose) {
          onClose();
        }
      }
    }
  };

  // Parse notification data for change details
  const renderRichContent = () => {
    try {
      const data = notification.metadata as any;

      if (!data) {
        return (
          <p className="text-gray-700 whitespace-pre-wrap">
            {notification.message || notification.description}
          </p>
        );
      }

      // Check if this is a change notification with structured data
      const changes = data.changes;

      if (changes) {
        return (
          <div className="space-y-3">
            {/* Message */}
            {notification.message && (
              <p className="text-gray-700">
                {notification.message}
              </p>
            )}

            {/* Change details */}
            <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Changes:</h4>

              {/* Status change */}
              {changes.status && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 min-w-24">Status:</span>
                  <span className="font-medium text-gray-900">{changes.status.old}</span>
                  <ArrowRight className="w-4 h-4 text-gray-400" />
                  <span className="font-medium text-blue-600">{changes.status.new}</span>
                </div>
              )}

              {/* Priority change */}
              {changes.priority && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 min-w-24">Priority:</span>
                  {renderPriority(changes.priority.old, changes.priority.oldColor)}
                  <ArrowRight className="w-4 h-4 text-gray-400" />
                  {renderPriority(changes.priority.new, changes.priority.newColor)}
                </div>
              )}

              {/* Assignment change */}
              {changes.assigned_to && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 min-w-24">Assigned to:</span>
                  <span className="font-medium text-gray-900">{changes.assigned_to.old}</span>
                  <ArrowRight className="w-4 h-4 text-gray-400" />
                  <span className="font-medium text-blue-600">{changes.assigned_to.new}</span>
                </div>
              )}

              {/* Performed by info */}
              {data.performedByName && (
                <div className="pt-2 mt-2 border-t border-gray-300">
                  <p className="text-sm text-gray-600">
                    Changed by: <span className="font-medium text-gray-900">{data.performedByName}</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      }

      // Check for priority in assigned notification
      if (data.priority && notification.title.includes('Assigned')) {
        return (
          <div className="space-y-3">
            <p className="text-gray-700">
              {notification.message}
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Priority:</span>
                {renderPriority(data.priority, data.priorityColor)}
              </div>
              {data.performedByName && (
                <p className="text-sm text-gray-600 mt-2">
                  Assigned by: <span className="font-medium text-gray-900">{data.performedByName}</span>
                </p>
              )}
            </div>
          </div>
        );
      }

      // Default: show the message
      return (
        <p className="text-gray-700 whitespace-pre-wrap">
          {notification.message || notification.description}
        </p>
      );
    } catch (error) {
      // Fallback to basic message display
      return (
        <p className="text-gray-700 whitespace-pre-wrap">
          {notification.message || notification.description}
        </p>
      );
    }
  };

  // Check if there's a comment preview (supports both old and new structure)
  const commentText = notification.metadata?.commentText || notification.metadata?.comment?.text;
  const hasCommentPreview = !!commentText;
  const isInternalComment = notification.metadata?.comment?.isInternal || false;

  return (
    <div className="h-full flex flex-col bg-white" id="notification-detail-view">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200">
        <div className="px-6 py-4">
          <div className="flex items-start justify-between mb-4">
            <div className={`flex items-center gap-3 p-3 rounded-lg ${style.bgColor} border ${style.borderColor}`}>
              <div className={style.iconColor}>
                {style.icon}
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {notification.title}
                </h2>
                {!notification.isRead && (
                  <Badge variant="default" className="mt-1 bg-blue-500">
                    Unread
                  </Badge>
                )}
              </div>
            </div>
            {onClose && (
              <Button
                id="close-notification-detail-button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </Button>
            )}
          </div>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
            {notification.category && (
              <div className="flex items-center gap-1.5">
                <Tag className="h-4 w-4" />
                <Badge variant="outline">{notification.category}</Badge>
              </div>
            )}
            {notification.createdAt && (
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                <span>
                  {format(new Date(notification.createdAt), 'MMM d, yyyy h:mm a')}
                </span>
                <span className="text-gray-400">
                  ({formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })})
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-6 space-y-4">
          {/* Main content */}
          <div className="prose max-w-none">
            {renderRichContent()}
          </div>

          {/* Comment preview (if available) */}
          {hasCommentPreview && (
            <div className={`border-l-4 ${
              isInternalComment ? 'border-yellow-400 bg-yellow-50' : 'border-blue-400 bg-blue-50'
            } p-4 rounded-r-md`}>
              <div className="flex items-start gap-2 mb-2">
                {notification.metadata?.commentAuthor && (
                  <span className="text-sm font-medium text-gray-700">
                    Comment by {notification.metadata.commentAuthor}:
                  </span>
                )}
                {isInternalComment && (
                  <Badge variant="outline" className="bg-yellow-100 border-yellow-300 text-yellow-800">
                    Internal Comment
                  </Badge>
                )}
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap">
                {commentText}
              </div>
            </div>
          )}

          {/* Additional metadata - Hidden for now as it shows internal UUIDs and technical details */}
          {/* {notification.metadata && Object.keys(notification.metadata).length > 0 && (
            <details className="mt-4">
              <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
                Additional Details
              </summary>
              <div className="mt-2 bg-gray-50 p-4 rounded-md">
                <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(notification.metadata, null, 2)}
                </pre>
              </div>
            </details>
          )} */}
        </div>
      </div>

      {/* Footer with action buttons */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50 px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            {notification.isRead && notification.readAt && (
              <span>
                Read {formatDistanceToNow(new Date(notification.readAt), { addSuffix: true })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onClose && (
              <Button
                id="close-notification-button"
                variant="outline"
                onClick={onClose}
              >
                Close
              </Button>
            )}
            {notification.link && (
              <Button
                id="view-related-entity-button"
                onClick={handleNavigateToEntity}
                className="gap-2 bg-primary-600 hover:bg-primary-700 text-white"
                size="lg"
              >
                {notification.link.includes('/msp/documents') ? 'Open Document' :
                 notification.link.includes('/msp/tickets/') || notification.link.includes('/client-portal/tickets/') ? 'View Ticket' :
                 notification.link.includes('/msp/projects/') && notification.link.includes('/tasks/') ? 'View Task' :
                 'View Details'}
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
