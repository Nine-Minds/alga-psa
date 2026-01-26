'use client';

import React from 'react';
import {
  PlusCircle,
  CheckCircle,
  RotateCcw,
  ArrowRight,
  User,
  Flag,
  Folder,
  Edit,
  Sliders,
  MessageCircle,
  Edit2,
  Trash2,
  Send,
  Mail,
  Paperclip,
  XCircle,
  Layers,
  Plus,
  Minus,
  Clock,
  AlertTriangle,
  AlertCircle,
  TrendingUp,
  GitMerge,
  GitBranch,
  HelpCircle
} from 'lucide-react';
import { TicketActivityType } from 'server/src/interfaces/ticketActivity.interfaces';

interface ActivityIconProps {
  activityType: TicketActivityType;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const ICON_MAP: Record<TicketActivityType, React.ComponentType<{ className?: string }>> = {
  ticket_created: PlusCircle,
  ticket_closed: CheckCircle,
  ticket_reopened: RotateCcw,
  status_change: ArrowRight,
  assignment_change: User,
  priority_change: Flag,
  category_change: Folder,
  field_change: Edit,
  custom_field_change: Sliders,
  comment_added: MessageCircle,
  comment_edited: Edit2,
  comment_deleted: Trash2,
  email_sent: Send,
  email_received: Mail,
  document_attached: Paperclip,
  document_removed: XCircle,
  bundle_created: Layers,
  bundle_child_added: Plus,
  bundle_child_removed: Minus,
  time_entry_added: Clock,
  time_entry_updated: Clock,
  sla_breach: AlertTriangle,
  sla_warning: AlertCircle,
  escalation: TrendingUp,
  merge: GitMerge,
  split: GitBranch
};

const COLOR_MAP: Record<TicketActivityType, string> = {
  ticket_created: 'text-green-500 bg-green-100',
  ticket_closed: 'text-blue-500 bg-blue-100',
  ticket_reopened: 'text-orange-500 bg-orange-100',
  status_change: 'text-purple-500 bg-purple-100',
  assignment_change: 'text-blue-500 bg-blue-100',
  priority_change: 'text-red-500 bg-red-100',
  category_change: 'text-gray-500 bg-gray-100',
  field_change: 'text-gray-500 bg-gray-100',
  custom_field_change: 'text-gray-500 bg-gray-100',
  comment_added: 'text-blue-500 bg-blue-100',
  comment_edited: 'text-gray-500 bg-gray-100',
  comment_deleted: 'text-red-500 bg-red-100',
  email_sent: 'text-green-500 bg-green-100',
  email_received: 'text-blue-500 bg-blue-100',
  document_attached: 'text-gray-500 bg-gray-100',
  document_removed: 'text-red-500 bg-red-100',
  bundle_created: 'text-purple-500 bg-purple-100',
  bundle_child_added: 'text-purple-500 bg-purple-100',
  bundle_child_removed: 'text-purple-500 bg-purple-100',
  time_entry_added: 'text-green-500 bg-green-100',
  time_entry_updated: 'text-gray-500 bg-gray-100',
  sla_breach: 'text-red-500 bg-red-100',
  sla_warning: 'text-orange-500 bg-orange-100',
  escalation: 'text-red-500 bg-red-100',
  merge: 'text-purple-500 bg-purple-100',
  split: 'text-purple-500 bg-purple-100'
};

const SIZE_MAP = {
  sm: 'w-6 h-6 p-1',
  md: 'w-8 h-8 p-1.5',
  lg: 'w-10 h-10 p-2'
};

const ICON_SIZE_MAP = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6'
};

/**
 * Displays an icon for a specific activity type with appropriate color
 */
export function ActivityIcon({
  activityType,
  className = '',
  size = 'md'
}: ActivityIconProps) {
  const Icon = ICON_MAP[activityType] || HelpCircle;
  const colorClass = COLOR_MAP[activityType] || 'text-gray-500 bg-gray-100';
  const sizeClass = SIZE_MAP[size];
  const iconSizeClass = ICON_SIZE_MAP[size];

  return (
    <div
      className={`rounded-full flex items-center justify-center ${colorClass} ${sizeClass} ${className}`}
    >
      <Icon className={iconSizeClass} />
    </div>
  );
}

/**
 * Get the label for an activity type
 */
export function getActivityLabel(activityType: TicketActivityType): string {
  const labels: Record<TicketActivityType, string> = {
    ticket_created: 'Created',
    ticket_closed: 'Closed',
    ticket_reopened: 'Reopened',
    status_change: 'Status Changed',
    assignment_change: 'Assigned',
    priority_change: 'Priority Changed',
    category_change: 'Category Changed',
    field_change: 'Field Updated',
    custom_field_change: 'Custom Field Updated',
    comment_added: 'Comment Added',
    comment_edited: 'Comment Edited',
    comment_deleted: 'Comment Deleted',
    email_sent: 'Email Sent',
    email_received: 'Email Received',
    document_attached: 'Document Attached',
    document_removed: 'Document Removed',
    bundle_created: 'Bundle Created',
    bundle_child_added: 'Added to Bundle',
    bundle_child_removed: 'Removed from Bundle',
    time_entry_added: 'Time Logged',
    time_entry_updated: 'Time Updated',
    sla_breach: 'SLA Breached',
    sla_warning: 'SLA Warning',
    escalation: 'Escalated',
    merge: 'Merged',
    split: 'Split'
  };

  return labels[activityType] || activityType;
}

/**
 * Get color class for an activity type (for badges, borders, etc.)
 */
export function getActivityColor(activityType: TicketActivityType): string {
  return COLOR_MAP[activityType] || 'text-gray-500 bg-gray-100';
}

export default ActivityIcon;
