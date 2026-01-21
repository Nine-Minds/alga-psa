/**
 * Ticket Activity interfaces
 *
 * Defines types for the visual timeline/activity feed feature
 * Tracks all events on a ticket in chronological order
 *
 * This is an incremental enhancement to existing ticket infrastructure,
 * providing a Halo-style activity timeline UI.
 */

/**
 * Types of activities that can be logged
 *
 * V1 ACTIVE - These are actively logged in ticketActions.ts:
 *   - ticket_created, ticket_closed, status_change, assignment_change, field_change
 *
 * V1 READY - Infrastructure exists but not yet wired:
 *   - comment_added, comment_edited, comment_deleted (wire in commentActions)
 *   - custom_field_change (wire in customFieldActions)
 *
 * FUTURE - Reserved for future features, not implemented:
 *   - ticket_reopened, email_*, document_*, bundle_*, time_entry_*, sla_*, escalation, merge, split
 */
export type TicketActivityType =
  // === V1 ACTIVE (logged in ticketActions.ts) ===
  | 'ticket_created'
  | 'ticket_closed'
  | 'status_change'
  | 'assignment_change'
  | 'priority_change'
  | 'category_change'
  | 'field_change'
  // === V1 READY (helpers exist, not yet wired) ===
  | 'custom_field_change'
  | 'comment_added'
  | 'comment_edited'
  | 'comment_deleted'
  // === FUTURE (reserved, not implemented) ===
  | 'ticket_reopened'
  | 'email_sent'
  | 'email_received'
  | 'document_attached'
  | 'document_removed'
  | 'bundle_created'
  | 'bundle_child_added'
  | 'bundle_child_removed'
  | 'time_entry_added'
  | 'time_entry_updated'
  | 'sla_breach'
  | 'sla_warning'
  | 'escalation'
  | 'merge'
  | 'split';

/**
 * Actor types for activity attribution
 */
export type ActivityActorType = 'internal' | 'client' | 'system' | 'email' | 'automation';

/**
 * Full activity record from database
 */
export interface ITicketActivity {
  activity_id: string;
  tenant: string;
  ticket_id: string;
  activity_type: TicketActivityType;
  // Actor info
  actor_id?: string | null;
  actor_type: ActivityActorType;
  actor_name?: string | null;
  // Change details
  field_name?: string | null;
  old_value?: any;
  new_value?: any;
  // Related entities
  comment_id?: string | null;
  email_id?: string | null;
  document_id?: string | null;
  time_entry_id?: string | null;
  linked_entity_type?: string | null;
  linked_entity_id?: string | null;
  // Metadata
  metadata: Record<string, any>;
  description?: string | null;
  // Visibility
  is_internal: boolean;
  is_system: boolean;
  // Timestamps
  created_at: string;
}

/**
 * Input for creating a new activity log entry
 */
export interface CreateTicketActivityInput {
  ticket_id: string;
  activity_type: TicketActivityType;
  actor_id?: string | null;
  actor_type?: ActivityActorType;
  actor_name?: string | null;
  field_name?: string | null;
  old_value?: any;
  new_value?: any;
  comment_id?: string | null;
  email_id?: string | null;
  document_id?: string | null;
  time_entry_id?: string | null;
  linked_entity_type?: string | null;
  linked_entity_id?: string | null;
  metadata?: Record<string, any>;
  description?: string | null;
  is_internal?: boolean;
  is_system?: boolean;
}

/**
 * Filters for querying activities
 */
export interface TicketActivityFilters {
  activity_types?: TicketActivityType[];
  actor_id?: string;
  actor_type?: ActivityActorType;
  start_date?: string;
  end_date?: string;
  include_internal?: boolean;
  include_system?: boolean;
}

/**
 * Pagination options for activity queries
 */
export interface ActivityPaginationOptions {
  limit?: number;
  offset?: number;
  cursor?: string;
}

/**
 * Response from paginated activity queries
 */
export interface PaginatedActivitiesResponse {
  activities: ITicketActivity[];
  total: number;
  has_more: boolean;
  next_cursor?: string;
}

/**
 * Activity counts by type (for filter badges)
 */
export type ActivityTypeCounts = Partial<Record<TicketActivityType, number>>;

/**
 * Grouped activities for timeline display
 */
export interface GroupedActivities {
  date: string;
  activities: ITicketActivity[];
}

/**
 * Activity display configuration
 */
export interface ActivityDisplayConfig {
  icon: string;
  color: string;
  label: string;
  description_template: string;
}

/**
 * Map of activity type to display config
 */
export const ACTIVITY_DISPLAY_CONFIG: Record<TicketActivityType, ActivityDisplayConfig> = {
  ticket_created: {
    icon: 'plus-circle',
    color: 'green',
    label: 'Created',
    description_template: '{actor} created the ticket'
  },
  ticket_closed: {
    icon: 'check-circle',
    color: 'blue',
    label: 'Closed',
    description_template: '{actor} closed the ticket'
  },
  ticket_reopened: {
    icon: 'rotate-ccw',
    color: 'orange',
    label: 'Reopened',
    description_template: '{actor} reopened the ticket'
  },
  status_change: {
    icon: 'arrow-right',
    color: 'purple',
    label: 'Status Changed',
    description_template: '{actor} changed status from {old_value} to {new_value}'
  },
  assignment_change: {
    icon: 'user',
    color: 'blue',
    label: 'Assigned',
    description_template: '{actor} assigned to {new_value}'
  },
  priority_change: {
    icon: 'flag',
    color: 'red',
    label: 'Priority Changed',
    description_template: '{actor} changed priority from {old_value} to {new_value}'
  },
  category_change: {
    icon: 'folder',
    color: 'gray',
    label: 'Category Changed',
    description_template: '{actor} changed category to {new_value}'
  },
  field_change: {
    icon: 'edit',
    color: 'gray',
    label: 'Field Updated',
    description_template: '{actor} updated {field_name}'
  },
  custom_field_change: {
    icon: 'sliders',
    color: 'gray',
    label: 'Custom Field Updated',
    description_template: '{actor} updated {field_name}'
  },
  comment_added: {
    icon: 'message-circle',
    color: 'blue',
    label: 'Comment',
    description_template: '{actor} added a comment'
  },
  comment_edited: {
    icon: 'edit-2',
    color: 'gray',
    label: 'Comment Edited',
    description_template: '{actor} edited a comment'
  },
  comment_deleted: {
    icon: 'trash-2',
    color: 'red',
    label: 'Comment Deleted',
    description_template: '{actor} deleted a comment'
  },
  email_sent: {
    icon: 'send',
    color: 'green',
    label: 'Email Sent',
    description_template: '{actor} sent an email'
  },
  email_received: {
    icon: 'mail',
    color: 'blue',
    label: 'Email Received',
    description_template: 'Email received from {actor}'
  },
  document_attached: {
    icon: 'paperclip',
    color: 'gray',
    label: 'Document Attached',
    description_template: '{actor} attached a document'
  },
  document_removed: {
    icon: 'x-circle',
    color: 'red',
    label: 'Document Removed',
    description_template: '{actor} removed a document'
  },
  bundle_created: {
    icon: 'layers',
    color: 'purple',
    label: 'Bundle Created',
    description_template: '{actor} created a ticket bundle'
  },
  bundle_child_added: {
    icon: 'plus',
    color: 'purple',
    label: 'Added to Bundle',
    description_template: '{actor} added ticket to bundle'
  },
  bundle_child_removed: {
    icon: 'minus',
    color: 'purple',
    label: 'Removed from Bundle',
    description_template: '{actor} removed ticket from bundle'
  },
  time_entry_added: {
    icon: 'clock',
    color: 'green',
    label: 'Time Logged',
    description_template: '{actor} logged {new_value}'
  },
  time_entry_updated: {
    icon: 'clock',
    color: 'gray',
    label: 'Time Updated',
    description_template: '{actor} updated time entry'
  },
  sla_breach: {
    icon: 'alert-triangle',
    color: 'red',
    label: 'SLA Breached',
    description_template: 'SLA breached: {field_name}'
  },
  sla_warning: {
    icon: 'alert-circle',
    color: 'orange',
    label: 'SLA Warning',
    description_template: 'SLA warning: {field_name}'
  },
  escalation: {
    icon: 'trending-up',
    color: 'red',
    label: 'Escalated',
    description_template: '{actor} escalated the ticket'
  },
  merge: {
    icon: 'git-merge',
    color: 'purple',
    label: 'Merged',
    description_template: '{actor} merged tickets'
  },
  split: {
    icon: 'git-branch',
    color: 'purple',
    label: 'Split',
    description_template: '{actor} split the ticket'
  }
};
