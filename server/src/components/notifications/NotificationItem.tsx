'use client';

import React from 'react';
import { Info, CheckCircle, AlertTriangle, AlertCircle, ExternalLink } from 'lucide-react';
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

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
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

          {/* Message */}
          <p className="text-sm text-gray-600 mb-2 line-clamp-2">
            {notification.message}
          </p>

          {/* Footer */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
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
