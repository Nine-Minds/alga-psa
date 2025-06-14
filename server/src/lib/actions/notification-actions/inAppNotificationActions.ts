'use server';

import { revalidatePath } from 'next/cache';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { 
  CreateNotificationData, 
  InternalNotification, 
  NotificationListResult,
  EnrichedNotification,
  Notification,
  NotificationSseEvent
} from 'server/src/interfaces/notification.interfaces';
import { NotificationPublisher } from 'server/src/lib/notifications/publisher';

/**
 * Convert EnrichedNotification to frontend-friendly Notification format
 */
function enrichedToFrontendNotification(enriched: EnrichedNotification): Notification {
  return {
    internal_notification_id: enriched.internal_notification_id,
    tenant: enriched.tenant,
    user_id: enriched.user_id,
    title: enriched.title,
    message: enriched.message,
    data: enriched.data,
    action_url: enriched.action_url,
    read_at: enriched.read_at,
    archived_at: enriched.archived_at,
    created_at: enriched.created_at,
    expires_at: enriched.expires_at,
    type_name: enriched.type.type_name,
    category_name: enriched.type.category_name,
    priority_name: enriched.priority?.priority_name,
    priority_color: enriched.priority?.color,
  };
}

/**
 * Create a new in-app notification for a specific user with real-time delivery.
 * This is the primary action for creating a single notification.
 */
export async function createNotificationAction(
  notificationData: CreateNotificationData
): Promise<InternalNotification> {
  const { tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();
  
  if (!tenant || !currentUser) {
    throw new Error('Authentication required');
  }

  // The publisher will handle fetching template/type info and broadcasting the event.
  const publisher = new NotificationPublisher();
  try {
    const targetUserId = notificationData.user_id !== undefined ? notificationData.user_id : currentUser.user_id;
    const dataToPublish: CreateNotificationData = {
      ...notificationData,
      user_id: String(targetUserId),
    };
    const notification = await publisher.publishNotification(dataToPublish);

    // Revalidate paths for the user who received the notification
    revalidatePath(`/users/${notification.user_id}/dashboard`);
    revalidatePath(`/users/${notification.user_id}/notifications`);

    return notification;
  } finally {
    publisher.disconnect();
  }
}

/**
 * Get notifications for the current user with pagination, enriched with type and priority details.
 */
export async function getNotificationsAction(
  page: number = 1,
  pageSize: number = 20,
  unreadOnly: boolean = false
): Promise<NotificationListResult> {
  const { knex, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!tenant || !currentUser) {
    throw new Error('Authentication required');
  }

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const offset = (page - 1) * pageSize;

    // Base query for notifications
    let query = trx('internal_notifications as n')
      .where('n.tenant', tenant)
      .where('n.user_id', currentUser.user_id)
      .whereNull('n.archived_at');

    if (unreadOnly) {
      query = query.whereNull('n.read_at');
    }

    // Get notifications with joins for enrichment
    const notifications: EnrichedNotification[] = await query
      .clone()
      .leftJoin('internal_notification_types as nt', 'n.type_id', 'nt.internal_notification_type_id')
      .leftJoin('standard_priorities as sp', 'n.priority_id', 'sp.priority_id')
      .select(
        'n.*',
        'nt.type_name',
        'nt.category_name',
        'sp.priority_name',
        'sp.color as priority_color'
      )
      .orderBy('n.created_at', 'desc')
      .limit(pageSize)
      .offset(offset)
      .then(rows => rows.map(r => ({
        ...r,
        type: {
          internal_notification_type_id: r.type_id,
          type_name: r.type_name,
          category_name: r.category_name,
        },
        priority: r.priority_id ? {
          priority_id: r.priority_id,
          priority_name: r.priority_name,
          color: r.priority_color,
        } : undefined,
      })));

    // Get total count
    const [{ count }] = await query.clone().count('n.internal_notification_id as count');

    return {
      notifications: notifications.map(enrichedToFrontendNotification),
      pagination: {
        page,
        pageSize,
        total: Number(count),
        pages: Math.ceil(Number(count) / pageSize)
      }
    };
  });
}

/**
 * Get unread notification count for the current user
 */
export async function getUnreadNotificationCountAction(): Promise<number> {
  const { knex, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!tenant || !currentUser) {
    return 0;
  }

  const [{ count }] = await knex('internal_notifications')
    .where('tenant', tenant)
    .where('user_id', currentUser.user_id)
    .whereNull('read_at')
    .whereNull('archived_at')
    .count('internal_notification_id as count');

  return Number(count);
}

/**
 * Mark a notification as read with real-time updates
 */
export async function markNotificationReadAction(notificationId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!tenant || !currentUser) {
    throw new Error('Authentication required');
  }

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const [updated] = await trx('internal_notifications')
      .where('tenant', tenant)
      .where('internal_notification_id', notificationId)
      .where('user_id', currentUser.user_id)
      .update({ read_at: new Date() })
      .returning('*');

    if (!updated) {
      throw new Error('Notification not found or access denied');
    }

    // Broadcast read status update via Redis
    const publisher = new NotificationPublisher();
    try {
      await publisher.publishNotificationRead(String(currentUser.user_id), notificationId, tenant);
    } finally {
      publisher.disconnect();
    }

    revalidatePath('/msp/dashboard');
    revalidatePath('/msp/notifications');
  });
}

/**
 * Mark all notifications as read for the current user
 */
export async function markAllNotificationsReadAction(): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!tenant || !currentUser) {
    throw new Error('Authentication required');
  }

  await knex('internal_notifications')
    .where('tenant', tenant)
    .where('user_id', currentUser.user_id)
    .whereNull('read_at')
    .update({ read_at: new Date() });

  revalidatePath('/msp/dashboard');
  revalidatePath('/msp/notifications');
}

/**
 * Archive a notification (soft delete)
 */
export async function archiveNotificationAction(notificationId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!tenant || !currentUser) {
    throw new Error('Authentication required');
  }

  const [updated] = await knex('internal_notifications')
    .where('tenant', tenant)
    .where('internal_notification_id', notificationId)
    .where('user_id', currentUser.user_id)
    .update({ archived_at: new Date() })
    .returning('*');

  if (!updated) {
    throw new Error('Notification not found or access denied');
  }

  revalidatePath('/msp/dashboard');
  revalidatePath('/msp/notifications');
}

/**
 * Create notifications for multiple users (bulk operation)
 */
export async function createBulkNotificationsAction(
  userIds: string[],
  notificationData: CreateNotificationData
): Promise<InternalNotification[]> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const notificationsToInsert = userIds.map(userId => ({
      tenant,
      user_id: String(userId),
      type_id: notificationData.type_id,
      title: notificationData.title,
      message: notificationData.message,
      data: notificationData.data ? JSON.stringify(notificationData.data) : null,
      action_url: notificationData.action_url,
      priority_id: notificationData.priority_id,
      expires_at: notificationData.expires_at,
    }));

    const notifications = await trx('internal_notifications')
      .insert(notificationsToInsert)
      .returning('*');

    // In a real scenario, you'd likely want to publish these to the event bus as well
    // For now, just revalidating paths
    revalidatePath('/msp/dashboard');
    revalidatePath('/msp/notifications');

    return notifications;
  });
}
