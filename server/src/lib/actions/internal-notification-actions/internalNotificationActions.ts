"use server"

import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import {
  InternalNotification,
  InternalNotificationTemplate,
  InternalNotificationCategory,
  InternalNotificationSubtype,
  InternalNotificationType,
  CreateInternalNotificationRequest,
  GetInternalNotificationsRequest,
  InternalNotificationListResponse,
  UnreadCountResponse,
  RenderedTemplate
} from "../../models/internalNotification";
import {
  broadcastNotification,
  broadcastNotificationRead,
  broadcastAllNotificationsRead,
  broadcastUnreadCount
} from "../../realtime/internalNotificationBroadcaster";

/**
 * Get user's locale preference from user_preferences table
 */
async function getUserLocale(
  trx: Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string> {
  const preference = await trx('user_preferences')
    .where({
      tenant,
      user_id: userId,
      setting_name: 'locale'
    })
    .first();

  return preference?.setting_value || 'en';
}

/**
 * Get notification template in user's preferred language with fallback chain
 * Fallback order: user's locale → tenant default → English → generic
 */
async function getNotificationTemplate(
  trx: Knex.Transaction,
  tenant: string,
  templateName: string,
  locale: string
): Promise<InternalNotificationTemplate | null> {
  // 1. Try user's preferred language
  let template = await trx('internal_notification_templates')
    .where({ name: templateName, language_code: locale })
    .first();

  if (template) return template;

  // 2. Try English as fallback
  template = await trx('internal_notification_templates')
    .where({ name: templateName, language_code: 'en' })
    .first();

  if (template) return template;

  // 3. Return null if no template found
  return null;
}

/**
 * Render template with provided data
 * Supports simple {{variable}} replacement
 */
function renderTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? String(data[key]) : match;
  });
}

/**
 * Create a notification from a template
 */
export async function createNotificationFromTemplateAction(
  request: CreateInternalNotificationRequest
): Promise<InternalNotification> {
  const { knex } = await (await import("../../db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get user's locale
    const userLocale = await getUserLocale(trx, request.tenant, request.user_id);

    // Get template in user's language
    const template = await getNotificationTemplate(
      trx,
      request.tenant,
      request.template_name,
      userLocale
    );

    if (!template) {
      throw new Error(`Template '${request.template_name}' not found`);
    }

    // Render template with data
    const title = renderTemplate(template.title, request.data);
    const message = renderTemplate(template.message, request.data);

    // Insert notification
    const [notification] = await trx('internal_notifications')
      .insert({
        tenant: request.tenant,
        user_id: request.user_id,
        template_name: request.template_name,
        language_code: userLocale,
        title,
        message,
        type: request.type || 'info',
        category: request.category || null,
        link: request.link || null,
        metadata: request.metadata ? JSON.stringify(request.metadata) : null,
        is_read: false,
        delivery_status: 'pending',
        delivery_attempts: 0
      })
      .returning('*');

    // Broadcast notification to connected clients (async, don't await)
    broadcastNotification(notification).catch(err => {
      console.error('Failed to broadcast notification:', err);
    });

    return notification;
  });
}

/**
 * Get paginated notifications for a user
 */
export async function getNotificationsAction(
  request: GetInternalNotificationsRequest
): Promise<InternalNotificationListResponse> {
  const { knex } = await (await import("../../db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const limit = request.limit || 20;
    const offset = request.offset || 0;

    // Build base query
    let query = trx('internal_notifications')
      .where({
        tenant: request.tenant,
        user_id: request.user_id
      })
      .whereNull('deleted_at');

    // Apply filters
    if (request.is_read !== undefined) {
      query = query.where({ is_read: request.is_read });
    }

    if (request.category) {
      query = query.where({ category: request.category });
    }

    // Get total count
    const [{ count: totalCount }] = await query.clone().count('* as count');

    // Get notifications
    const notifications = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // Get unread count
    const [{ count: unreadCount }] = await trx('internal_notifications')
      .where({
        tenant: request.tenant,
        user_id: request.user_id,
        is_read: false
      })
      .whereNull('deleted_at')
      .count('* as count');

    return {
      notifications,
      total: Number(totalCount),
      unread_count: Number(unreadCount),
      has_more: Number(totalCount) > offset + limit
    };
  });
}

/**
 * Get unread notification count
 */
export async function getUnreadCountAction(
  tenant: string,
  userId: string,
  byCategory: boolean = false
): Promise<UnreadCountResponse> {
  const { knex } = await (await import("../../db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get total unread count
    const [{ count: unreadCount }] = await trx('internal_notifications')
      .where({
        tenant,
        user_id: userId,
        is_read: false
      })
      .whereNull('deleted_at')
      .count('* as count');

    const response: UnreadCountResponse = {
      unread_count: Number(unreadCount)
    };

    // Get counts by category if requested
    if (byCategory) {
      const categoryCounts = await trx('internal_notifications')
        .where({
          tenant,
          user_id: userId,
          is_read: false
        })
        .whereNull('deleted_at')
        .whereNotNull('category')
        .select('category')
        .count('* as count')
        .groupBy('category');

      response.by_category = categoryCounts.reduce((acc, row) => {
        acc[row.category] = Number(row.count);
        return acc;
      }, {} as Record<string, number>);
    }

    return response;
  });
}

/**
 * Mark a single notification as read
 */
export async function markAsReadAction(
  tenant: string,
  userId: string,
  notificationId: number
): Promise<InternalNotification> {
  const { knex } = await (await import("../../db")).createTenantKnex();

  const notification = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const [notif] = await trx('internal_notifications')
      .where({
        internal_notification_id: notificationId,
        tenant,
        user_id: userId
      })
      .update({
        is_read: true,
        read_at: trx.fn.now(),
        updated_at: trx.fn.now()
      })
      .returning('*');

    if (!notif) {
      throw new Error('Notification not found');
    }

    return notif;
  });

  // Broadcast notification read (async, don't await)
  broadcastNotificationRead(tenant, userId, notificationId).catch(err => {
    console.error('Failed to broadcast notification read:', err);
  });

  return notification;
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsReadAction(
  tenant: string,
  userId: string
): Promise<{ updated_count: number }> {
  const { knex } = await (await import("../../db")).createTenantKnex();

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const updatedCount = await trx('internal_notifications')
      .where({
        tenant,
        user_id: userId,
        is_read: false
      })
      .whereNull('deleted_at')
      .update({
        is_read: true,
        read_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });

    return { updated_count: updatedCount };
  });

  // Broadcast all notifications read (async, don't await)
  broadcastAllNotificationsRead(tenant, userId).catch(err => {
    console.error('Failed to broadcast all notifications read:', err);
  });

  return result;
}

/**
 * Soft delete a notification
 */
export async function deleteNotificationAction(
  tenant: string,
  userId: string,
  notificationId: number
): Promise<void> {
  const { knex } = await (await import("../../db")).createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx('internal_notifications')
      .where({
        internal_notification_id: notificationId,
        tenant,
        user_id: userId
      })
      .update({
        deleted_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });
  });
}

/**
 * Get all categories
 */
export async function getCategoriesAction(): Promise<InternalNotificationCategory[]> {
  const { knex } = await (await import("../../db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('internal_notification_categories')
      .where({ is_enabled: true })
      .orderBy('name');
  });
}

/**
 * Get subtypes for a category
 */
export async function getSubtypesAction(
  categoryId: number
): Promise<InternalNotificationSubtype[]> {
  const { knex } = await (await import("../../db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('internal_notification_subtypes')
      .where({
        internal_category_id: categoryId,
        is_enabled: true
      })
      .orderBy('name');
  });
}

/**
 * Get all templates for a specific template name (all languages)
 */
export async function getTemplatesForNameAction(
  templateName: string
): Promise<InternalNotificationTemplate[]> {
  const { knex } = await (await import("../../db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('internal_notification_templates')
      .where({ name: templateName })
      .orderBy('language_code');
  });
}
