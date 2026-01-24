"use server"

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { hasPermissionAsync } from '../../lib/authHelpers';
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
  RenderedTemplate,
  UserInternalNotificationPreference,
  UpdateUserInternalNotificationPreferenceRequest
} from "../../types/internalNotification";
import {
  broadcastNotification,
  broadcastNotificationRead,
  broadcastAllNotificationsRead,
  broadcastUnreadCount
} from "../../realtime/internalNotificationBroadcaster";
import logger from '@alga-psa/core/logger';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildNotificationReadPayload,
  buildNotificationSentPayload,
} from '@shared/workflow/streams/domainEventBuilders/notificationEventBuilders';

/**
 * Get user's locale preference with fallback hierarchy:
 * MSP Internal Users: Always English (ignore preferences)
 * Client Portal Users:
 * 1. User's language preference (user_preferences.locale)
 * 2. Client company language (clients.properties.defaultLocale)
 * 3. Tenant language (tenant_settings.settings.defaultLocale)
 * 4. Default to 'en'
 */
async function getUserLocale(
  trx: Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string> {
  // First, check user type
  const user = await trx('users as u')
    .select('u.user_type', 'u.contact_id', 'c.properties')
    .leftJoin('contacts as con', function() {
      this.on('u.contact_id', 'con.contact_name_id')
          .andOn('u.tenant', 'con.tenant');
    })
    .leftJoin('clients as c', function() {
      this.on('con.client_id', 'c.client_id')
          .andOn('con.tenant', 'c.tenant');
    })
    .where('u.user_id', userId)
    .andWhere('u.tenant', tenant)
    .first();

  // MSP internal users always get English, regardless of preferences
  if (user?.user_type === 'internal') {
    return 'en';
  }

  // For client portal users, use preference hierarchy
  // 1. Try user's language preference
  const userPreference = await trx('user_preferences')
    .where({
      tenant,
      user_id: userId,
      setting_name: 'locale'
    })
    .first();

  if (userPreference?.setting_value) {
    return userPreference.setting_value;
  }

  // 2. Try client company language
  if (user?.properties?.defaultLocale) {
    return user.properties.defaultLocale;
  }

  // 3. Try tenant-wide default language
  const tenantSettings = await trx('tenant_settings')
    .select('settings')
    .where({ tenant })
    .first();

  if (tenantSettings?.settings?.defaultLocale) {
    return tenantSettings.settings.defaultLocale;
  }

  // 4. Default to English
  return 'en';
}

/**
 * Get notification template in the specified language with fallback to English
 * Note: The locale parameter comes from getUserLocale() which already handles:
 * 1. User's language preference
 * 2. Client company language
 * 3. Tenant language
 * 4. English default
 */
async function getNotificationTemplate(
  trx: Knex.Transaction,
  tenant: string,
  templateName: string,
  locale: string
): Promise<InternalNotificationTemplate | null> {
  // 1. Try the requested language (from getUserLocale hierarchy)
  let template = await trx('internal_notification_templates')
    .where({ name: templateName, language_code: locale })
    .first();

  if (template) return template;

  // 2. Try English as final fallback
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

function normalizeDateTime(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

function safePublishNotificationWorkflowEvent(params: Parameters<typeof publishWorkflowEvent>[0]): void {
  void publishWorkflowEvent(params).catch((error) => {
    logger.warn('[InternalNotificationActions] Failed to publish workflow notification event', {
      error: error instanceof Error ? error.message : String(error),
      eventType: params.eventType,
    });
  });
}

/**
 * Internal helper to create a notification from a template (used by event subscribers)
 * Accepts an existing Knex connection to avoid creating a new transaction
 */
export async function createNotificationFromTemplateInternal(
  knex: Knex,
  request: CreateInternalNotificationRequest
): Promise<InternalNotification | null> {
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

    // Check if user has this notification type enabled
    const subtypeId = template.subtype_id;
    const isEnabled = await checkInternalNotificationEnabled(trx, request.tenant, request.user_id, subtypeId);

    if (!isEnabled) {
      console.log(`Internal notification disabled for user ${request.user_id}, subtype ${subtypeId}`);
      return null;
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

    const createdAt = normalizeDateTime(notification?.created_at);

    safePublishNotificationWorkflowEvent({
      eventType: 'NOTIFICATION_SENT',
      payload: buildNotificationSentPayload({
        notificationId: notification.internal_notification_id,
        channel: 'in_app',
        recipientId: request.user_id,
        sentAt: createdAt,
        templateId: request.template_name,
      }),
      ctx: {
        tenantId: request.tenant,
        occurredAt: createdAt,
        actor: { actorType: 'SYSTEM' },
        correlationId: `notification:${notification.internal_notification_id}`,
      },
      idempotencyKey: `notification:${notification.internal_notification_id}:sent`,
    });

    // Broadcast notification to connected clients (async, don't await)
    broadcastNotification(notification).catch(err => {
      console.error('Failed to broadcast notification:', err);
    });

    return notification;
  });
}

/**
 * Create a notification from a template (Server Action for UI components)
 */
export async function createNotificationFromTemplateAction(
  request: CreateInternalNotificationRequest
): Promise<InternalNotification | null> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

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

    // Check if user has this notification type enabled
    const subtypeId = template.subtype_id;
    const isEnabled = await checkInternalNotificationEnabled(trx, request.tenant, request.user_id, subtypeId);

    if (!isEnabled) {
      console.log(`Internal notification disabled for user ${request.user_id}, subtype ${subtypeId}`);
      return null;
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

    const createdAt = normalizeDateTime(notification?.created_at);

    safePublishNotificationWorkflowEvent({
      eventType: 'NOTIFICATION_SENT',
      payload: buildNotificationSentPayload({
        notificationId: notification.internal_notification_id,
        channel: 'in_app',
        recipientId: request.user_id,
        sentAt: createdAt,
        templateId: request.template_name,
      }),
      ctx: {
        tenantId: request.tenant,
        occurredAt: createdAt,
        actor: { actorType: 'SYSTEM' },
        correlationId: `notification:${notification.internal_notification_id}`,
      },
      idempotencyKey: `notification:${notification.internal_notification_id}:sent`,
    });

    // Broadcast notification to connected clients (async, don't await)
    broadcastNotification(notification).catch(err => {
      console.error('Failed to broadcast notification:', err);
    });

    return notification;
  });
}

/**
 * Internal helper to check if internal notifications are enabled (used within transaction)
 */
async function checkInternalNotificationEnabled(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  subtypeId: number
): Promise<boolean> {
  // 1. Get subtype info
  const subtype = await trx('internal_notification_subtypes')
    .where({ internal_notification_subtype_id: subtypeId })
    .first();

  if (!subtype) {
    return false;
  }

  // 2. Check tenant-specific subtype setting (replaces global check)
  const subtypeSetting = await trx('tenant_internal_notification_subtype_settings')
    .where({ tenant, subtype_id: subtypeId })
    .first();

  const isSubtypeEnabled = subtypeSetting?.is_enabled ?? true;
  if (!isSubtypeEnabled) {
    return false;
  }

  // 3. Verify category exists
  const category = await trx('internal_notification_categories')
    .where({ internal_notification_category_id: subtype.internal_category_id })
    .first();

  if (!category) {
    return false; // Category not found - don't send notification
  }

  // 4. Check tenant-specific category setting (replaces global check)
  const categorySetting = await trx('tenant_internal_notification_category_settings')
    .where({ tenant, category_id: subtype.internal_category_id })
    .first();

  const isCategoryEnabled = categorySetting?.is_enabled ?? true;
  if (!isCategoryEnabled) {
    return false;
  }

  // 5. Check user-specific preferences (EXISTING - unchanged)
  const userSubtypePreference = await trx('user_internal_notification_preferences')
    .where({ tenant, user_id: userId, subtype_id: subtypeId })
    .first();

  if (userSubtypePreference) {
    return userSubtypePreference.is_enabled;
  }

  // 6. Check user category preference (EXISTING - unchanged)
  const userCategoryPreference = await trx('user_internal_notification_preferences')
    .where({ tenant, user_id: userId, category_id: subtype.internal_category_id })
    .whereNull('subtype_id')
    .first();

  if (userCategoryPreference) {
    return userCategoryPreference.is_enabled;
  }

  // 7. Fall back to tenant's default
  return subtypeSetting?.is_default_enabled ?? true;
}

/**
 * Get paginated notifications for a user
 */
export async function getNotificationsAction(
  request: GetInternalNotificationsRequest
): Promise<InternalNotificationListResponse> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  console.log('[getNotificationsAction] Fetching notifications for:', {
    tenant: request.tenant,
    user_id: request.user_id,
    limit: request.limit,
    offset: request.offset,
    is_read: request.is_read,
    category: request.category
  });

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
 * Get a single notification by internal notification ID
 */
export async function getNotificationByIdAction(
  internalNotificationId: string,
  tenant: string,
  userId: string
): Promise<InternalNotification | null> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const notification = await trx('internal_notifications')
      .where({
        internal_notification_id: internalNotificationId,
        tenant,
        user_id: userId
      })
      .whereNull('deleted_at')
      .first();

    return notification || null;
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
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

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

      response.by_category = categoryCounts.reduce<Record<string, number>>((acc, row) => {
        acc[row.category] = Number(row.count);
        return acc;
      }, {});
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
  notificationId: string
): Promise<InternalNotification> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

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

  const readAt = normalizeDateTime(notification.read_at);

  safePublishNotificationWorkflowEvent({
    eventType: 'NOTIFICATION_READ',
    payload: buildNotificationReadPayload({
      notificationId,
      channel: 'in_app',
      recipientId: userId,
      readAt,
    }),
    ctx: {
      tenantId: tenant,
      occurredAt: readAt,
      actor: { actorType: 'USER', actorUserId: userId },
      correlationId: `notification:${notificationId}`,
    },
    idempotencyKey: `notification:${notificationId}:read`,
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
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

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
  notificationId: string
): Promise<void> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

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
import { withAuth } from '@alga-psa/auth';

export const getInternalNotificationCategoriesAction = withAuth(async (
  _user,
  { tenant },
  forClientPortal?: boolean,
  locale?: string
): Promise<InternalNotificationCategory[]> => {
  const { createTenantKnex } = await import('@alga-psa/db');
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    let query = trx('internal_notification_categories as inc')
      .leftJoin('tenant_internal_notification_category_settings as tics', function() {
        this.on('tics.category_id', 'inc.internal_notification_category_id')
            .andOn('tics.tenant', trx.raw('?', [tenant]));
      })
      .select(
        'inc.internal_notification_category_id',
        'inc.name',
        'inc.description',
        'inc.available_for_client_portal',
        'inc.created_at',
        'inc.updated_at',
        trx.raw('COALESCE(tics.is_enabled, true) as is_enabled'),
        trx.raw('COALESCE(tics.is_default_enabled, true) as is_default_enabled')
      )
      .orderBy('inc.name');

    // Categories are translated in the frontend using i18n keys
    // No need to fetch display_title from database

    if (forClientPortal === true) {
      query = query.where({ 'inc.available_for_client_portal': true });
    }

    return await query;
  });
});

/**
 * Get subtypes for a category
 */
export const getSubtypesAction = withAuth(async (
  _user,
  { tenant },
  categoryId: number,
  forClientPortal?: boolean,
  locale?: string
): Promise<InternalNotificationSubtype[]> => {
  const { createTenantKnex } = await import('@alga-psa/db');
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    let query = trx('internal_notification_subtypes as ins')
      .leftJoin('tenant_internal_notification_subtype_settings as tiss', function() {
        this.on('tiss.subtype_id', 'ins.internal_notification_subtype_id')
            .andOn('tiss.tenant', trx.raw('?', [tenant]));
      })
      .where('ins.internal_category_id', categoryId)
      .select(
        'ins.internal_notification_subtype_id',
        'ins.name',
        'ins.description',
        'ins.internal_category_id',
        'ins.available_for_client_portal',
        'ins.created_at',
        'ins.updated_at',
        trx.raw('COALESCE(tiss.is_enabled, true) as is_enabled'),
        trx.raw('COALESCE(tiss.is_default_enabled, true) as is_default_enabled')
      );

    // Get translated title using subquery to avoid duplicate rows
    // (multiple templates can exist for the same subtype_id + language_code)
    if (locale) {
      query = query
        .select(trx.raw('(SELECT title FROM internal_notification_templates WHERE subtype_id = ins.internal_notification_subtype_id AND language_code = ? LIMIT 1) as display_title', [locale]));
    }

    if (forClientPortal === true) {
      query = query.where({ 'ins.available_for_client_portal': true });
    }

    return await query.orderBy('ins.name');
  });
});

/**
 * Get all templates for a specific template name (all languages)
 */
export async function getTemplatesForNameAction(
  templateName: string
): Promise<InternalNotificationTemplate[]> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('internal_notification_templates')
      .where({ name: templateName })
      .orderBy('language_code');
  });
}

/**
 * Get user's internal notification preferences
 */
export async function getUserInternalNotificationPreferencesAction(
  tenant: string,
  userId: string
): Promise<UserInternalNotificationPreference[]> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('user_internal_notification_preferences')
      .where({
        tenant,
        user_id: userId
      })
      .orderBy('preference_id');
  });
}

/**
 * Update or create a user's internal notification preference
 */
export async function updateUserInternalNotificationPreferenceAction(
  request: UpdateUserInternalNotificationPreferenceRequest
): Promise<UserInternalNotificationPreference> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check if preference exists
    const existing = await trx('user_internal_notification_preferences')
      .where({
        tenant: request.tenant,
        user_id: request.user_id,
        category_id: request.category_id || null,
        subtype_id: request.subtype_id || null
      })
      .first();

    if (existing) {
      // Update existing preference
      const [updated] = await trx('user_internal_notification_preferences')
        .where({
          preference_id: existing.preference_id
        })
        .update({
          is_enabled: request.is_enabled,
          updated_at: trx.fn.now()
        })
        .returning('*');
      return updated;
    } else {
      // Create new preference
      const [created] = await trx('user_internal_notification_preferences')
        .insert({
          tenant: request.tenant,
          user_id: request.user_id,
          category_id: request.category_id || null,
          subtype_id: request.subtype_id || null,
          is_enabled: request.is_enabled
        })
        .returning('*');
      return created;
    }
  });
}

/**
 * Check if a user has internal notifications enabled for a specific subtype
 */
export async function isInternalNotificationEnabledAction(
  tenant: string,
  userId: string,
  subtypeId: number
): Promise<boolean> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check for specific subtype preference
    const subtypePreference = await trx('user_internal_notification_preferences')
      .where({
        tenant,
        user_id: userId,
        subtype_id: subtypeId
      })
      .first();

    if (subtypePreference) {
      return subtypePreference.is_enabled;
    }

    // Get the category for this subtype
    const subtype = await trx('internal_notification_subtypes')
      .where({ internal_notification_subtype_id: subtypeId })
      .first();

    if (!subtype) {
      return true; // Default to enabled if subtype not found
    }

    // Check for category-level preference
    const categoryPreference = await trx('user_internal_notification_preferences')
      .where({
        tenant,
        user_id: userId,
        category_id: subtype.internal_category_id,
        subtype_id: null
      })
      .first();

    if (categoryPreference) {
      return categoryPreference.is_enabled;
    }

    // Default to subtype's default setting
    return subtype.is_default_enabled;
  });
}

/**
 * Update internal notification category (tenant-specific)
 * Requires 'settings' 'update' permission
 */
export const updateInternalCategoryAction = withAuth(async (
  currentUser,
  { tenant },
  categoryId: number,
  updates: Partial<Pick<InternalNotificationCategory, 'is_enabled' | 'is_default_enabled'>>
): Promise<InternalNotificationCategory> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check permission within transaction context
    const hasUpdatePermission = await hasPermissionAsync(currentUser, 'settings', 'update', trx);
    if (!hasUpdatePermission) {
      throw new Error('Permission denied: Cannot update settings');
    }

    // Verify category exists
    const category = await trx('internal_notification_categories')
      .where({ internal_notification_category_id: categoryId })
      .first();

    if (!category) {
      throw new Error('Category not found');
    }

    // Get existing tenant settings (if any) to preserve values not being updated
    const existingSettings = await trx('tenant_internal_notification_category_settings')
      .where({ tenant, category_id: categoryId })
      .first();

    // Build update object with only defined values, defaulting to existing or true
    const is_enabled = updates.is_enabled ?? existingSettings?.is_enabled ?? true;
    const is_default_enabled = updates.is_default_enabled ?? existingSettings?.is_default_enabled ?? true;
    // Compute timestamp before query - CitusDB requires IMMUTABLE values in ON CONFLICT UPDATE
    const now = new Date();

    // Upsert into tenant-specific settings table
    await trx('tenant_internal_notification_category_settings')
      .insert({
        tenant,
        category_id: categoryId,
        is_enabled,
        is_default_enabled
      })
      .onConflict(['tenant', 'category_id'])
      .merge({
        is_enabled,
        is_default_enabled,
        updated_at: now
      });

    return {
      ...category,
      is_enabled,
      is_default_enabled
    };
  });
});

/**
 * Update internal notification subtype (tenant-specific)
 * Requires 'settings' 'update' permission
 */
export const updateInternalSubtypeAction = withAuth(async (
  currentUser,
  { tenant },
  subtypeId: number,
  updates: Partial<Pick<InternalNotificationSubtype, 'is_enabled' | 'is_default_enabled'>>
): Promise<InternalNotificationSubtype> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check permission within transaction context
    const hasUpdatePermission = await hasPermissionAsync(currentUser, 'settings', 'update', trx);
    if (!hasUpdatePermission) {
      throw new Error('Permission denied: Cannot update settings');
    }

    // Verify subtype exists
    const subtype = await trx('internal_notification_subtypes')
      .where({ internal_notification_subtype_id: subtypeId })
      .first();

    if (!subtype) {
      throw new Error('Subtype not found');
    }

    // Get existing tenant settings (if any) to preserve values not being updated
    const existingSettings = await trx('tenant_internal_notification_subtype_settings')
      .where({ tenant, subtype_id: subtypeId })
      .first();

    // Build update object with only defined values, defaulting to existing or true
    const is_enabled = updates.is_enabled ?? existingSettings?.is_enabled ?? true;
    const is_default_enabled = updates.is_default_enabled ?? existingSettings?.is_default_enabled ?? true;
    // Compute timestamp before query - CitusDB requires IMMUTABLE values in ON CONFLICT UPDATE
    const now = new Date();

    // Upsert into tenant-specific settings table
    await trx('tenant_internal_notification_subtype_settings')
      .insert({
        tenant,
        subtype_id: subtypeId,
        is_enabled,
        is_default_enabled
      })
      .onConflict(['tenant', 'subtype_id'])
      .merge({
        is_enabled,
        is_default_enabled,
        updated_at: now
      });

    return {
      ...subtype,
      is_enabled,
      is_default_enabled
    };
  });
});
