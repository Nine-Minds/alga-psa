'use client';

import React from 'react';
import { Info, CheckCircle, AlertTriangle, AlertCircle, ExternalLink, ArrowRight } from 'lucide-react';
import type { InternalNotification } from '../../lib/models/internalNotification';

interface NotificationItemProps {
  notification: InternalNotification;
  onClick: () => void;
}

export function NotificationItem({ notification, onClick }: NotificationItemProps) {
  const isUnread = !notification.is_read;

  // Get icon based on notification type
  const getIcon = () => {
    switch (notification.type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  // Get category color
  const getCategoryColor = () => {
    switch (notification.category) {
      case 'tickets':
        return 'bg-blue-100 text-blue-700';
      case 'projects':
        return 'bg-purple-100 text-purple-700';
      case 'invoices':
        return 'bg-green-100 text-green-700';
      case 'system':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
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
        <span className="font-medium">{name}</span>
      </div>
    );
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string | null | undefined): string => {
    if (!timestamp) {
      return 'Unknown';
    }

    try {
      const date = new Date(timestamp);

      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.warn('Invalid date for notification:', timestamp);
        return 'Unknown';
      }

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) {
        return 'Just now';
      } else if (diffMins < 60) {
        return `${diffMins}m ago`;
      } else if (diffHours < 24) {
        return `${diffHours}h ago`;
      } else if (diffDays < 7) {
        return `${diffDays}d ago`;
      } else {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
      }
    } catch (error) {
      console.error('Error formatting date:', error, timestamp);
      return 'Unknown';
    }
  };

  // Check if this is a comment notification with preview (supports both old and new structure)
  const commentText = notification.metadata?.commentPreview || notification.metadata?.comment?.text;
  const hasCommentPreview = !!commentText;
  const isInternalComment = notification.metadata?.comment?.isInternal || false;

  // Parse notification data for change details
  const renderRichContent = () => {
    try {
      // Try to parse the metadata field if it exists
      const data = notification.metadata as any;

      if (!data) {
        return (
          <p className="text-sm text-gray-600 mb-2 line-clamp-2">
            {notification.message}
          </p>
        );
      }

      // Check if this is a change notification with structured data
      const changes = data.changes;

      if (changes) {
        return (
          <div className="space-y-1 mb-2">
            {/* Status change */}
            {changes.status && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">Status:</span>
                <span className="font-medium text-gray-900">{changes.status.old}</span>
                <ArrowRight className="w-4 h-4 text-gray-400" />
                <span className="font-medium text-blue-600">{changes.status.new}</span>
              </div>
            )}

            {/* Priority change */}
            {changes.priority && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">Priority:</span>
                {renderPriority(changes.priority.old, changes.priority.oldColor)}
                <ArrowRight className="w-4 h-4 text-gray-400" />
                {renderPriority(changes.priority.new, changes.priority.newColor)}
              </div>
            )}

            {/* Assignment change */}
            {changes.assigned_to && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">Assigned:</span>
                <span className="font-medium text-gray-900">{changes.assigned_to.old}</span>
                <ArrowRight className="w-4 h-4 text-gray-400" />
                <span className="font-medium text-blue-600">{changes.assigned_to.new}</span>
              </div>
            )}

            {/* Performed by info */}
            {data.performedByName && (
              <p className="text-xs text-gray-500 mt-1">
                by {data.performedByName}
              </p>
            )}
          </div>
        );
      }

      // Check for priority in assigned notification
      if (data.priority && notification.title.includes('Assigned')) {
        return (
          <div className="space-y-1 mb-2">
            <p className="text-sm text-gray-600">
              {notification.message}
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Priority:</span>
              {renderPriority(data.priority, data.priorityColor)}
            </div>
            {data.performedByName && (
              <p className="text-xs text-gray-500 mt-1">
                by {data.performedByName}
              </p>
            )}
          </div>
        );
      }

      // Default: show the message
      return (
        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
          {notification.message}
        </p>
      );
    } catch (error) {
      // Fallback to basic message display
      return (
        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
          {notification.message}
        </p>
      );
    }
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
        isUnread ? 'bg-blue-50/50' : ''
      }`}
    >
      <div className="flex gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {getIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title and timestamp */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className={`text-sm font-medium text-gray-900 ${isUnread ? 'font-semibold' : ''}`}>
              {notification.title}
            </h4>
            {isUnread && (
              <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-1.5" />
            )}
          </div>

          {/* Rich content with change details */}
          {renderRichContent()}

          {/* Comment preview (if available) */}
          {hasCommentPreview && (
            <div className={`mt-2 pl-3 border-l-2 ${
              isInternalComment ? 'border-yellow-400 bg-yellow-50/50' : 'border-blue-300 bg-blue-50/50'
            } py-1.5 px-3 rounded-r`}>
              <p className="text-xs text-gray-700 line-clamp-2">
                {commentText}
              </p>
              {isInternalComment && (
                <span className="inline-flex items-center gap-1 mt-1 text-xs text-yellow-700">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  Internal
                </span>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-2">
            {/* Category badge */}
            {notification.category && (
              <span className={`px-2 py-0.5 rounded-full font-medium ${getCategoryColor()}`}>
                {notification.category}
              </span>
            )}

            {/* Timestamp */}
            <span>{formatTimestamp(notification.created_at)}</span>

            {/* Link indicator */}
            {notification.link && (
              <span className="flex items-center gap-0.5 text-main-600">
                <ExternalLink className="w-3 h-3" />
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
