'use server';

import { revalidatePath } from 'next/cache';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { 
  CreateNotificationData, 
  Notification, 
  NotificationListResult,
  NotificationEvent
} from 'server/src/interfaces/notification.interfaces';
import { NotificationPublisher } from 'server/src/lib/notifications/publisher';
import { v4 as uuidv4 } from 'uuid';

/**
 * Create a new in-app notification for a specific user with real-time delivery
 */
export async function createNotificationAction(
  userId: number,
  notificationData: CreateNotificationData
): Promise<Notification> {
  const { tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Create notification event for publisher
  const notificationEvent: NotificationEvent = {
    id: uuidv4(),
    tenant,
    userId,
    type: notificationData.type,
    category: notificationData.category,
    title: notificationData.title,
    message: notificationData.message,
    data: notificationData.data,
    actionUrl: notificationData.actionUrl,
    priority: notificationData.priority || 'normal',
  };

  // Use publisher to save and broadcast notification
  const publisher = new NotificationPublisher();
  try {
    const notification = await publisher.publishNotification(notificationEvent);

    // Revalidate notification-related paths
    revalidatePath('/msp/dashboard');
    revalidatePath('/msp/notifications');

    return notification;
  } finally {
    publisher.disconnect();
  }
}

/**
 * Get notifications for the current user with pagination
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

    // Build base query
    let query = trx('notifications')
      .where('tenant', tenant)
      .where('user_id', currentUser.user_id)
      .where('archived_at', null);

    if (unreadOnly) {
      query = query.where('read_at', null);
    }

    // Get notifications with pagination
    const notifications = await query
      .clone()
      .orderBy('created_at', 'desc')
      .limit(pageSize)
      .offset(offset)
      .select('*');

    // Get total count
    const [{ count }] = await query
      .clone()
      .count('id as count');

    return {
      notifications,
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
    throw new Error('Authentication required');
  }

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const [{ count }] = await trx('notifications')
      .where('tenant', tenant)
      .where('user_id', currentUser.user_id)
      .where('read_at', null)
      .where('archived_at', null)
      .count('id as count');

    return Number(count);
  });
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
    const [updated] = await trx('notifications')
      .where('tenant', tenant)
      .where('id', notificationId)
      .where('user_id', currentUser.user_id)
      .update({
        read_at: new Date()
      })
      .returning('*');

    if (!updated) {
      throw new Error('Notification not found or access denied');
    }

    // Broadcast read status update via Redis
    const publisher = new NotificationPublisher();
    try {
      await publisher.publishNotificationRead(currentUser.user_id, notificationId, tenant);
    } finally {
      publisher.disconnect();
    }

    // Revalidate notification-related paths
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

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx('notifications')
      .where('tenant', tenant)
      .where('user_id', currentUser.user_id)
      .where('read_at', null)
      .update({
        read_at: new Date()
      });

    // Revalidate notification-related paths
    revalidatePath('/msp/dashboard');
    revalidatePath('/msp/notifications');
  });
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

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const [updated] = await trx('notifications')
      .where('tenant', tenant)
      .where('id', notificationId)
      .where('user_id', currentUser.user_id)
      .update({
        archived_at: new Date()
      })
      .returning('*');

    if (!updated) {
      throw new Error('Notification not found or access denied');
    }

    // Revalidate notification-related paths
    revalidatePath('/msp/dashboard');
    revalidatePath('/msp/notifications');
  });
}

/**
 * Create notifications for multiple users (bulk operation)
 */
export async function createBulkNotificationsAction(
  userIds: number[],
  notificationData: CreateNotificationData
): Promise<Notification[]> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const notificationsToInsert = userIds.map(userId => ({
      tenant,
      user_id: userId,
      type: notificationData.type,
      category: notificationData.category,
      title: notificationData.title,
      message: notificationData.message,
      data: notificationData.data ? JSON.stringify(notificationData.data) : null,
      action_url: notificationData.actionUrl,
      priority: notificationData.priority || 'normal',
      expires_at: notificationData.expiresAt,
      created_at: new Date()
    }));

    const notifications = await trx('notifications')
      .insert(notificationsToInsert)
      .returning('*');

    // Revalidate notification-related paths
    revalidatePath('/msp/dashboard');
    revalidatePath('/msp/notifications');

    return notifications;
  });
}