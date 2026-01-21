'use client';

import React from 'react';
import { ITicketActivity } from 'server/src/interfaces/ticketActivity.interfaces';
import { ActivityIcon, getActivityLabel } from 'server/src/components/ui/ActivityIcon';
import { FieldChangeDiff } from './FieldChangeDiff';
import { Badge } from 'server/src/components/ui/Badge';
import { Lock, Eye } from 'lucide-react';

interface TimelineItemProps {
  activity: ITicketActivity;
  showConnector?: boolean;
  className?: string;
}

/**
 * Formats a timestamp for display
 */
function formatTimestamp(timestamp: string): { time: string; relative: string } {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });

  let relative: string;
  if (diffMins < 1) {
    relative = 'Just now';
  } else if (diffMins < 60) {
    relative = `${diffMins}m ago`;
  } else if (diffHours < 24) {
    relative = `${diffHours}h ago`;
  } else if (diffDays < 7) {
    relative = `${diffDays}d ago`;
  } else {
    relative = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }

  return { time, relative };
}

/**
 * Generates activity description text
 */
function getActivityDescription(activity: ITicketActivity): string {
  const actor = activity.actor_name || 'System';

  switch (activity.activity_type) {
    case 'ticket_created':
      return `${actor} created this ticket`;
    case 'ticket_closed':
      return `${actor} closed this ticket`;
    case 'ticket_reopened':
      return `${actor} reopened this ticket`;
    case 'status_change':
      return `${actor} changed the status`;
    case 'assignment_change':
      if (activity.new_value) {
        const assigneeName = activity.metadata?.assignee_name || activity.new_value;
        return `${actor} assigned to ${assigneeName}`;
      }
      return `${actor} unassigned the ticket`;
    case 'priority_change':
      return `${actor} changed the priority`;
    case 'category_change':
      return `${actor} changed the category`;
    case 'field_change':
    case 'custom_field_change':
      return `${actor} updated ${activity.field_name || 'a field'}`;
    case 'comment_added':
      return `${actor} added a comment`;
    case 'comment_edited':
      return `${actor} edited a comment`;
    case 'comment_deleted':
      return `${actor} deleted a comment`;
    case 'email_sent':
      return `${actor} sent an email`;
    case 'email_received':
      return `Email received from ${actor}`;
    case 'document_attached':
      return `${actor} attached a document`;
    case 'document_removed':
      return `${actor} removed a document`;
    case 'bundle_created':
      return `${actor} created a ticket bundle`;
    case 'bundle_child_added':
      return `${actor} added a ticket to the bundle`;
    case 'bundle_child_removed':
      return `${actor} removed a ticket from the bundle`;
    case 'time_entry_added':
      return `${actor} logged time`;
    case 'time_entry_updated':
      return `${actor} updated a time entry`;
    case 'sla_breach':
      return `SLA breached: ${activity.field_name || 'Response time'}`;
    case 'sla_warning':
      return `SLA warning: ${activity.field_name || 'Approaching deadline'}`;
    case 'escalation':
      return `${actor} escalated this ticket`;
    case 'merge':
      return `${actor} merged tickets`;
    case 'split':
      return `${actor} split this ticket`;
    default:
      return activity.description || `${actor} performed an action`;
  }
}

/**
 * Individual timeline activity item
 */
export function TimelineItem({
  activity,
  showConnector = true,
  className = ''
}: TimelineItemProps) {
  const { time, relative } = formatTimestamp(activity.created_at);
  const description = getActivityDescription(activity);
  const showDiff = (activity.activity_type === 'field_change' ||
    activity.activity_type === 'custom_field_change' ||
    activity.activity_type === 'status_change' ||
    activity.activity_type === 'priority_change') &&
    (activity.old_value !== undefined || activity.new_value !== undefined);

  return (
    <div className={`relative flex gap-3 ${className}`}>
      {/* Timeline connector */}
      {showConnector && (
        <div className="absolute left-4 top-10 bottom-0 w-0.5 bg-gray-200" />
      )}

      {/* Icon */}
      <div className="relative z-10">
        <ActivityIcon activityType={activity.activity_type} size="md" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-sm text-gray-900">{description}</p>

            {/* Badges */}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-500" title={time}>
                {relative}
              </span>
              {activity.is_internal && (
                <Badge variant="secondary" className="text-xs py-0 px-1.5">
                  <Lock className="w-3 h-3 mr-1" />
                  Internal
                </Badge>
              )}
              {activity.is_system && (
                <Badge variant="outline" className="text-xs py-0 px-1.5">
                  System
                </Badge>
              )}
            </div>
          </div>

          {/* Activity type badge */}
          <Badge variant="outline" className="text-xs shrink-0">
            {getActivityLabel(activity.activity_type)}
          </Badge>
        </div>

        {/* Field change diff */}
        {showDiff && activity.field_name && (
          <div className="mt-2">
            <FieldChangeDiff
              fieldName={activity.field_name}
              oldValue={activity.old_value}
              newValue={activity.new_value}
              variant="inline"
            />
          </div>
        )}

        {/* Time entry details */}
        {activity.activity_type === 'time_entry_added' && activity.new_value && (
          <div className="mt-2 text-sm text-gray-600">
            Logged: <span className="font-medium">{activity.new_value}</span>
          </div>
        )}

        {/* Custom description override */}
        {activity.description && activity.activity_type !== 'ticket_created' && (
          <p className="mt-2 text-sm text-gray-600 italic">
            {activity.description}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Date separator for grouping timeline items by date
 */
export function TimelineDateSeparator({ date }: { date: string }) {
  const dateObj = new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let label: string;
  if (dateObj.toDateString() === today.toDateString()) {
    label = 'Today';
  } else if (dateObj.toDateString() === yesterday.toDateString()) {
    label = 'Yesterday';
  } else {
    label = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: dateObj.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
    });
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 h-px bg-gray-200" />
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

export default TimelineItem;
