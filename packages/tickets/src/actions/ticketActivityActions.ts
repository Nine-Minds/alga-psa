'use server'

import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/users/actions';
import {
  ITicketActivity,
  CreateTicketActivityInput,
  TicketActivityFilters,
  ActivityPaginationOptions,
  PaginatedActivitiesResponse,
  ActivityTypeCounts,
  GroupedActivities,
  TicketActivityType
} from 'server/src/interfaces/ticketActivity.interfaces';

/**
 * Parse JSONB fields from database row
 */
function parseActivityRow(row: any): ITicketActivity {
  return {
    ...row,
    old_value: row.old_value
      ? (typeof row.old_value === 'string' ? JSON.parse(row.old_value) : row.old_value)
      : null,
    new_value: row.new_value
      ? (typeof row.new_value === 'string' ? JSON.parse(row.new_value) : row.new_value)
      : null,
    metadata: row.metadata
      ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata)
      : {}
  };
}

/**
 * Get activity timeline for a ticket
 */
export async function getTicketTimeline(
  ticketId: string,
  filters?: TicketActivityFilters,
  options?: ActivityPaginationOptions
): Promise<PaginatedActivitiesResponse> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  let query = knex('ticket_activity_log')
    .where({ tenant, ticket_id: ticketId })
    .orderBy('created_at', 'desc');

  // Apply filters
  if (filters) {
    if (filters.activity_types && filters.activity_types.length > 0) {
      query = query.whereIn('activity_type', filters.activity_types);
    }
    if (filters.actor_id) {
      query = query.where('actor_id', filters.actor_id);
    }
    if (filters.actor_type) {
      query = query.where('actor_type', filters.actor_type);
    }
    if (filters.start_date) {
      query = query.where('created_at', '>=', filters.start_date);
    }
    if (filters.end_date) {
      query = query.where('created_at', '<=', filters.end_date);
    }
    if (filters.include_internal === false) {
      query = query.where('is_internal', false);
    }
    if (filters.include_system === false) {
      query = query.where('is_system', false);
    }
  }

  // Get total count
  const countQuery = query.clone();
  const [{ count }] = await countQuery.count('* as count');
  const total = parseInt(count as string, 10);

  // Get paginated results
  const activities = await query
    .limit(limit)
    .offset(offset);

  return {
    activities: activities.map(parseActivityRow),
    total,
    has_more: offset + activities.length < total,
    next_cursor: offset + activities.length < total
      ? String(offset + limit)
      : undefined
  };
}

/**
 * Get a single activity by ID
 */
export async function getTicketActivityById(
  activityId: string
): Promise<ITicketActivity | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const activity = await knex('ticket_activity_log')
    .where({ tenant, activity_id: activityId })
    .first();

  if (!activity) {
    return null;
  }

  return parseActivityRow(activity);
}

/**
 * Log a new ticket activity
 */
export async function logTicketActivity(
  input: CreateTicketActivityInput
): Promise<ITicketActivity> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const newActivity = {
    tenant,
    ticket_id: input.ticket_id,
    activity_type: input.activity_type,
    actor_id: input.actor_id ?? currentUser.user_id,
    actor_type: input.actor_type ?? 'internal',
    actor_name: input.actor_name ?? `${currentUser.first_name} ${currentUser.last_name}`.trim(),
    field_name: input.field_name ?? null,
    old_value: input.old_value !== undefined ? JSON.stringify(input.old_value) : null,
    new_value: input.new_value !== undefined ? JSON.stringify(input.new_value) : null,
    comment_id: input.comment_id ?? null,
    email_id: input.email_id ?? null,
    document_id: input.document_id ?? null,
    time_entry_id: input.time_entry_id ?? null,
    linked_entity_type: input.linked_entity_type ?? null,
    linked_entity_id: input.linked_entity_id ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
    description: input.description ?? null,
    is_internal: input.is_internal ?? false,
    is_system: input.is_system ?? false,
    created_at: new Date().toISOString()
  };

  const [created] = await knex('ticket_activity_log')
    .insert(newActivity)
    .returning('*');

  return parseActivityRow(created);
}

/**
 * Log multiple activities at once (batch insert)
 */
export async function logTicketActivitiesBatch(
  inputs: CreateTicketActivityInput[]
): Promise<ITicketActivity[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const now = new Date().toISOString();
  const actorName = `${currentUser.first_name} ${currentUser.last_name}`.trim();

  const newActivities = inputs.map(input => ({
    tenant,
    ticket_id: input.ticket_id,
    activity_type: input.activity_type,
    actor_id: input.actor_id ?? currentUser.user_id,
    actor_type: input.actor_type ?? 'internal',
    actor_name: input.actor_name ?? actorName,
    field_name: input.field_name ?? null,
    old_value: input.old_value !== undefined ? JSON.stringify(input.old_value) : null,
    new_value: input.new_value !== undefined ? JSON.stringify(input.new_value) : null,
    comment_id: input.comment_id ?? null,
    email_id: input.email_id ?? null,
    document_id: input.document_id ?? null,
    time_entry_id: input.time_entry_id ?? null,
    linked_entity_type: input.linked_entity_type ?? null,
    linked_entity_id: input.linked_entity_id ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
    description: input.description ?? null,
    is_internal: input.is_internal ?? false,
    is_system: input.is_system ?? false,
    created_at: now
  }));

  const created = await knex('ticket_activity_log')
    .insert(newActivities)
    .returning('*');

  return created.map(parseActivityRow);
}

/**
 * Get activity counts by type for a ticket
 */
export async function getActivityTypeCounts(
  ticketId: string
): Promise<ActivityTypeCounts> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const counts = await knex('ticket_activity_log')
    .where({ tenant, ticket_id: ticketId })
    .select('activity_type')
    .count('* as count')
    .groupBy('activity_type');

  const result: ActivityTypeCounts = {};
  counts.forEach((row: any) => {
    result[row.activity_type as TicketActivityType] = parseInt(row.count, 10);
  });

  return result;
}

/**
 * Get activities grouped by date for timeline display
 */
export async function getActivitiesGroupedByDate(
  ticketId: string,
  filters?: TicketActivityFilters
): Promise<GroupedActivities[]> {
  const { activities } = await getTicketTimeline(ticketId, filters, { limit: 500 });

  // Group by date
  const grouped: Record<string, ITicketActivity[]> = {};

  activities.forEach(activity => {
    const date = activity.created_at.split('T')[0];
    if (!grouped[date]) {
      grouped[date] = [];
    }
    grouped[date].push(activity);
  });

  // Convert to array sorted by date (newest first)
  return Object.entries(grouped)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, activities]) => ({ date, activities }));
}

/**
 * Get recent activity across multiple tickets (for dashboard)
 */
export async function getRecentTicketActivity(
  options?: {
    limit?: number;
    ticketIds?: string[];
    activityTypes?: TicketActivityType[];
  }
): Promise<ITicketActivity[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  let query = knex('ticket_activity_log')
    .where({ tenant })
    .orderBy('created_at', 'desc')
    .limit(options?.limit ?? 20);

  if (options?.ticketIds && options.ticketIds.length > 0) {
    query = query.whereIn('ticket_id', options.ticketIds);
  }

  if (options?.activityTypes && options.activityTypes.length > 0) {
    query = query.whereIn('activity_type', options.activityTypes);
  }

  const activities = await query;
  return activities.map(parseActivityRow);
}

/**
 * Delete activities for a ticket (used when deleting a ticket)
 */
export async function deleteTicketActivities(ticketId: string): Promise<number> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const deleted = await knex('ticket_activity_log')
    .where({ tenant, ticket_id: ticketId })
    .delete();

  return deleted;
}

/**
 * Helper: Log a field change activity
 */
export async function logFieldChange(
  ticketId: string,
  fieldName: string,
  oldValue: any,
  newValue: any,
  isCustomField: boolean = false
): Promise<ITicketActivity> {
  return logTicketActivity({
    ticket_id: ticketId,
    activity_type: isCustomField ? 'custom_field_change' : 'field_change',
    field_name: fieldName,
    old_value: oldValue,
    new_value: newValue
  });
}

/**
 * Helper: Log a status change activity
 */
export async function logStatusChange(
  ticketId: string,
  oldStatus: string,
  newStatus: string,
  metadata?: Record<string, any>
): Promise<ITicketActivity> {
  return logTicketActivity({
    ticket_id: ticketId,
    activity_type: 'status_change',
    field_name: 'status',
    old_value: oldStatus,
    new_value: newStatus,
    metadata
  });
}

/**
 * Helper: Log an assignment change activity
 */
export async function logAssignmentChange(
  ticketId: string,
  oldAssignee: string | null,
  newAssignee: string | null,
  newAssigneeName?: string
): Promise<ITicketActivity> {
  return logTicketActivity({
    ticket_id: ticketId,
    activity_type: 'assignment_change',
    field_name: 'assigned_to',
    old_value: oldAssignee,
    new_value: newAssignee,
    metadata: newAssigneeName ? { assignee_name: newAssigneeName } : undefined
  });
}

/**
 * Helper: Log a comment activity
 */
export async function logCommentActivity(
  ticketId: string,
  commentId: string,
  action: 'added' | 'edited' | 'deleted',
  isInternal: boolean = false
): Promise<ITicketActivity> {
  const activityType = action === 'added'
    ? 'comment_added'
    : action === 'edited'
      ? 'comment_edited'
      : 'comment_deleted';

  return logTicketActivity({
    ticket_id: ticketId,
    activity_type: activityType,
    comment_id: commentId,
    is_internal: isInternal
  });
}

/**
 * Helper: Log ticket creation
 */
export async function logTicketCreated(
  ticketId: string,
  metadata?: Record<string, any>
): Promise<ITicketActivity> {
  return logTicketActivity({
    ticket_id: ticketId,
    activity_type: 'ticket_created',
    metadata
  });
}

/**
 * Helper: Log ticket closure
 */
export async function logTicketClosed(
  ticketId: string,
  resolution?: string
): Promise<ITicketActivity> {
  return logTicketActivity({
    ticket_id: ticketId,
    activity_type: 'ticket_closed',
    metadata: resolution ? { resolution } : undefined
  });
}
