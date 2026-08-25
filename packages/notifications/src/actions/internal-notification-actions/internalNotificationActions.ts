"use server"

import { tenantDb, withTransaction, registerAfterCommit } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermissionAsync } from '../../lib/authHelpers';
import {
  InternalNotification,
  InternalNotificationTemplate,
  InternalNotificationCategory,
  InternalNotificationSubtype,
  InternalNotificationType,
  InternalNotificationPriority,
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
import { runPostCreationHooks } from './notificationHooks';
import {
  createNotificationRowFromTemplate,
  resolveNotificationPriority as resolveNotificationPriorityCore,
} from './createNotificationCore';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildNotificationReadPayload,
  buildNotificationSentPayload,
} from '@alga-psa/workflow-streams';
import {
  notificationActionErrorFrom,
  type NotificationActionError,
} from '../notificationActionErrors';

function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string) {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

/**
 * Get user's locale preference with fallback hierarchy:
 *
 * Internal (MSP) users:
 * 1. User's language preference (user_preferences.locale)
 * 2. Tenant MSP portal default (tenant_settings.settings.mspPortal.defaultLocale)
 * 3. Tenant-wide default (tenant_settings.settings.defaultLocale)
 * 4. System default ('en')
 *
 * Client portal users:
 * 1. User's language preference (user_preferences.locale)
 * 2. Client company language (clients.properties.defaultLocale)
 * 3. Tenant client portal default (tenant_settings.settings.clientPortal.defaultLocale)
 * 4. Tenant-wide default (tenant_settings.settings.defaultLocale)
 * 5. System default ('en')
 */
// getUserLocale, getNotificationTemplate, renderTemplate,
// checkInternalNotificationEnabled, and priority resolution live in
// createNotificationCore.ts so the temporal worker can reuse them without
// this module's auth/realtime dependencies.

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
  // This helper lives in a "use server" module, so it is registered as a server
  // action and is client-reachable. Refuse anything that is not a real
  // server-side Knex connection/transaction: withTransaction() would otherwise
  // interpret a caller-supplied tenant id string as a request to open a
  // connection to that tenant, letting a remote caller forge notifications for
  // arbitrary users via request.tenant/request.user_id.
  if (typeof (knex as unknown as { transaction?: unknown } | null)?.transaction !== 'function') {
    throw new Error('createNotificationFromTemplateInternal requires a server-side database connection');
  }
  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const notification = await createNotificationRowFromTemplate(
      trx,
      request.tenant,
      request.user_id,
      request
    );

    if (!notification) {
      return null;
    }

    const createdAt = normalizeDateTime(notification?.created_at);

    // External effects must not run inside the open transaction: the enclosing
    // ledger transaction can still roll back (effect failure, completion-mark
    // failure, crash before commit) or be replayed by the recovery sweeper,
    // either of which would orphan or duplicate them. registerAfterCommit
    // attaches them to the owning transaction and flushes them exactly once
    // after a successful commit; on rollback the queue is dropped. This gives
    // at-most-once per committed transaction: a crash after commit but before
    // the flush loses the fire-and-forget effect (same exposure as before
    // deferral) — never emit for a rolled-back transaction, never double-emit
    // on replay.
    registerAfterCommit(
      trx,
      () => {
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
            correlationId: notification.internal_notification_id,
          },
          idempotencyKey: `notification:${notification.internal_notification_id}:sent`,
        });

        // Broadcast notification to connected clients (async, don't await)
        broadcastNotification(notification).catch(err => {
          console.error('Failed to broadcast notification:', err);
        });

        // Fire post-creation hooks (e.g., push notifications)
        runPostCreationHooks(notification);
      },
      `notification=${notification.internal_notification_id} broadcast`
    );

    return notification;
  });
}

/**
 * Create a notification from a template (Server Action for UI components)
 *
 * Notifications can only be created for the authenticated user — any
 * tenant/user_id supplied in the request is ignored in favor of the session.
 * Server-side event subscribers that need to notify other users must use
 * createNotificationFromTemplateInternal with a real Knex connection instead.
 */
export const createNotificationFromTemplateAction = withAuth(async (
  currentUser,
  { tenant },
  request: CreateInternalNotificationRequest
): Promise<InternalNotification | null | NotificationActionError> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  const targetTenant = tenant;
  const targetUserId = currentUser.user_id;

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const notification = await createNotificationRowFromTemplate(
        trx,
        targetTenant,
        targetUserId,
        request
      );

      if (!notification) {
        return null;
      }

      const createdAt = normalizeDateTime(notification?.created_at);

      // Defer the external effects (workflow event publication + realtime
      // broadcast) until the owning transaction commits so a rollback cannot
      // orphan them and a replay cannot double-emit; see the identical
      // registerAfterCommit block in createNotificationFromTemplateInternal.
      registerAfterCommit(
        trx,
        () => {
          safePublishNotificationWorkflowEvent({
            eventType: 'NOTIFICATION_SENT',
            payload: buildNotificationSentPayload({
              notificationId: notification.internal_notification_id,
              channel: 'in_app',
              recipientId: targetUserId,
              sentAt: createdAt,
              templateId: request.template_name,
            }),
            ctx: {
              tenantId: targetTenant,
              occurredAt: createdAt,
              actor: { actorType: 'SYSTEM' },
              correlationId: notification.internal_notification_id,
            },
            idempotencyKey: `notification:${notification.internal_notification_id}:sent`,
          });

          // Broadcast notification to connected clients (async, don't await)
          broadcastNotification(notification).catch(err => {
            console.error('Failed to broadcast notification:', err);
          });
        },
        `notification=${notification.internal_notification_id} broadcast`
      );

      return notification;
    });
  } catch (error) {
    const expected = notificationActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Resolve the effective priority for a notification about to be created.
 * Delegates to createNotificationCore; kept exported here (async, per
 * "use server" rules) for existing callers.
 */
export async function resolveNotificationPriority(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  subtypeId: number
): Promise<InternalNotificationPriority> {
  return resolveNotificationPriorityCore(trx, tenant, userId, subtypeId);
}

/**
 * Get paginated notifications for a user
 *
 * Only the authenticated user's own notifications are returned — tenant and
 * user_id in the request are ignored in favor of the session.
 */
export const getNotificationsAction = withAuth(async (
  currentUser,
  { tenant },
  request: GetInternalNotificationsRequest
): Promise<InternalNotificationListResponse> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  const userId = currentUser.user_id;

  console.log('[getNotificationsAction] Fetching notifications for:', {
    tenant,
    user_id: userId,
    limit: request.limit,
    offset: request.offset,
    is_read: request.is_read,
    category: request.category
  });

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const limit = request.limit || 20;
    const offset = request.offset || 0;

    // Build base query
    let query = tenantScopedTable(trx, 'internal_notifications', tenant)
      .where({
        user_id: userId
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
    const [{ count: unreadCount }] = await tenantScopedTable(trx, 'internal_notifications', tenant)
      .where({
        user_id: userId,
        is_read: false
      })
      .whereNull('deleted_at')
      .count('* as count');

    // Unread high-priority count so the bell badge can render high-only
    // (task 29.8.46) without a second round-trip.
    const [{ count: unreadHighCount }] = await tenantScopedTable(trx, 'internal_notifications', tenant)
      .where({
        user_id: userId,
        is_read: false,
        priority: 'high'
      })
      .whereNull('deleted_at')
      .count('* as count');

    return {
      notifications,
      total: Number(totalCount),
      unread_count: Number(unreadCount),
      unread_high: Number(unreadHighCount),
      has_more: Number(totalCount) > offset + limit
    };
  });
});

/**
 * Get a single notification by internal notification ID
 *
 * Only the authenticated user's own notifications are accessible — the
 * caller-supplied tenant/userId arguments are retained for call-site
 * compatibility but ignored in favor of the session.
 */
export const getNotificationByIdAction = withAuth(async (
  currentUser,
  { tenant },
  internalNotificationId: string,
  _callerTenant?: string,
  _callerUserId?: string
): Promise<InternalNotification | null> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const notification = await tenantScopedTable(trx, 'internal_notifications', tenant)
      .where({
        internal_notification_id: internalNotificationId,
        user_id: currentUser.user_id
      })
      .whereNull('deleted_at')
      .first();

    return notification || null;
  });
});

/**
 * Get unread notification count
 *
 * Counts only the authenticated user's own notifications — the caller-supplied
 * tenant/userId arguments are retained for call-site compatibility but ignored
 * in favor of the session.
 */
export const getUnreadCountAction = withAuth(async (
  currentUser,
  { tenant },
  _callerTenant?: string,
  _callerUserId?: string,
  byCategory: boolean = false
): Promise<UnreadCountResponse> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  const userId = currentUser.user_id;

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get total unread count
    const [{ count: unreadCount }] = await tenantScopedTable(trx, 'internal_notifications', tenant)
      .where({
        user_id: userId,
        is_read: false
      })
      .whereNull('deleted_at')
      .count('* as count');

    // Split the unread count by priority tier so the bell can render a
    // high-only badge (and a neutral dot for normal/low) without a second
    // round-trip. `total` mirrors `unread_count`; `high` is unread-high.
    const [{ count: highUnreadCount }] = await tenantScopedTable(trx, 'internal_notifications', tenant)
      .where({
        user_id: userId,
        is_read: false,
        priority: 'high'
      })
      .whereNull('deleted_at')
      .count('* as count');

    const response: UnreadCountResponse = {
      unread_count: Number(unreadCount),
      total: Number(unreadCount),
      high: Number(highUnreadCount)
    };

    // Get counts by category if requested
    if (byCategory) {
      const categoryCounts = await tenantScopedTable(trx, 'internal_notifications', tenant)
        .where({
          user_id: userId,
          is_read: false
        })
        .whereNull('deleted_at')
        .whereNotNull('category')
        .select('category')
        .count('* as count')
        .groupBy('category') as Array<{ category: string; count: string | number }>;

      response.by_category = categoryCounts.reduce<Record<string, number>>((acc, row) => {
        acc[row.category] = Number(row.count);
        return acc;
      }, {});
    }

    return response;
  });
});

/**
 * Mark a single notification as read
 *
 * Only the authenticated user's own notifications can be modified — the
 * caller-supplied tenant/userId arguments are retained for call-site
 * compatibility but ignored in favor of the session.
 */
export const markAsReadAction = withAuth(async (
  currentUser,
  { tenant },
  _callerTenant: string,
  _callerUserId: string,
  notificationId: string
): Promise<InternalNotification | NotificationActionError> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  const userId = currentUser.user_id;

  const notification = await (async () => {
    try {
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        const [notif] = await tenantScopedTable(trx, 'internal_notifications', tenant)
          .where({
            internal_notification_id: notificationId,
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
    } catch (error) {
      const expected = notificationActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  })();

  if ('actionError' in notification || 'permissionError' in notification) {
    return notification;
  }

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
      correlationId: notificationId,
    },
    idempotencyKey: `notification:${notificationId}:read`,
  });

  // Broadcast notification read (async, don't await)
  broadcastNotificationRead(tenant, userId, notificationId).catch(err => {
    console.error('Failed to broadcast notification read:', err);
  });

  return notification;
});

/**
 * Mark all notifications as read for a user
 *
 * Only the authenticated user's own notifications can be modified — the
 * caller-supplied tenant/userId arguments are retained for call-site
 * compatibility but ignored in favor of the session.
 */
export const markAllAsReadAction = withAuth(async (
  currentUser,
  { tenant },
  _callerTenant: string,
  _callerUserId: string
): Promise<{ updated_count: number }> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  const userId = currentUser.user_id;

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const updatedCount = await tenantScopedTable(trx, 'internal_notifications', tenant)
      .where({
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
});

/**
 * Soft delete a notification
 *
 * Only the authenticated user's own notifications can be deleted — the
 * caller-supplied tenant/userId arguments are retained for call-site
 * compatibility but ignored in favor of the session.
 */
export const deleteNotificationAction = withAuth(async (
  currentUser,
  { tenant },
  _callerTenant: string,
  _callerUserId: string,
  notificationId: string
): Promise<void> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await tenantScopedTable(trx, 'internal_notifications', tenant)
      .where({
        internal_notification_id: notificationId,
        user_id: currentUser.user_id
      })
      .update({
        deleted_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });
  });
});

/**
 * Get all categories
 */

export const getInternalNotificationCategoriesAction = withAuth(async (
  _user,
  { tenant },
  forClientPortal?: boolean,
  locale?: string
): Promise<InternalNotificationCategory[]> => {
  const { createTenantKnex } = await import('@alga-psa/db');
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    let query = db.table('internal_notification_categories as inc') as Knex.QueryBuilder<any, any>;
    db.tenantJoin(query, 'tenant_internal_notification_category_settings as tics', 'tics.category_id', 'inc.internal_notification_category_id', {
      type: 'left',
      tenantPredicate: 'literal',
    });

    query = query
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
    const db = tenantDb(trx, tenant);
    let query = db.table('internal_notification_subtypes as ins') as Knex.QueryBuilder<any, any>;
    db.tenantJoin(query, 'tenant_internal_notification_subtype_settings as tiss', 'tiss.subtype_id', 'ins.internal_notification_subtype_id', {
      type: 'left',
      tenantPredicate: 'literal',
    });

    query = query
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
        trx.raw('COALESCE(tiss.is_default_enabled, true) as is_default_enabled'),
        // Priority (task 29.8.46): the subtype's system default, the tenant's
        // override (NULL = inherit), and the effective value to display.
        trx.raw("COALESCE(ins.default_priority, 'normal') as default_priority"),
        trx.raw('tiss.priority as tenant_priority'),
        trx.raw("COALESCE(tiss.priority, ins.default_priority, 'normal') as effective_priority")
      );

    // Get translated title using subquery to avoid duplicate rows
    // (multiple templates can exist for the same subtype_id + language_code)
    if (locale) {
      query = query
        .select({
          display_title: tenantScopedTable(trx, 'internal_notification_templates', tenant)
            .select('title')
            .whereRaw('subtype_id = ins.internal_notification_subtype_id')
            .andWhere('language_code', locale)
            .limit(1)
        });
    }

    if (forClientPortal === true) {
      query = query.where({ 'ins.available_for_client_portal': true });
    }

    return await query.orderBy('ins.name');
  });
});

/**
 * Get all templates for a specific template name (all languages)
 *
 * Templates are a global (non-tenant-scoped) catalog, so this only requires an
 * authenticated session.
 */
export const getTemplatesForNameAction = withAuth(async (
  _user,
  _ctx,
  templateName: string
): Promise<InternalNotificationTemplate[]> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, '__internal_notification_template_name_lookup__')
      .table<InternalNotificationTemplate>('internal_notification_templates')
      .where({ name: templateName })
      .orderBy('language_code');
  });
});

/**
 * Get user's internal notification preferences
 *
 * Only the authenticated user's own preferences are returned — the
 * caller-supplied tenant/userId arguments are retained for call-site
 * compatibility but ignored in favor of the session.
 */
export const getUserInternalNotificationPreferencesAction = withAuth(async (
  currentUser,
  { tenant },
  _callerTenant?: string,
  _callerUserId?: string
): Promise<UserInternalNotificationPreference[]> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantScopedTable(trx, 'user_internal_notification_preferences', tenant)
      .where({
        user_id: currentUser.user_id
      })
      .orderBy('preference_id');
  });
});

/**
 * Update or create a user's internal notification preference
 *
 * Only the authenticated user's own preferences can be modified — tenant and
 * user_id in the request are ignored in favor of the session.
 */
export const updateUserInternalNotificationPreferenceAction = withAuth(async (
  currentUser,
  { tenant },
  request: UpdateUserInternalNotificationPreferenceRequest
): Promise<UserInternalNotificationPreference> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  const userId = currentUser.user_id;

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check if preference exists
    const existing = await tenantScopedTable(trx, 'user_internal_notification_preferences', tenant)
      .where({
        user_id: userId,
        category_id: request.category_id || null,
        subtype_id: request.subtype_id || null
      })
      .first();

    // Priority overrides are meaningful on subtype-level rows only; category
    // rows always keep priority NULL. `null` clears an override; omitting the
    // key preserves any existing value (task 29.8.46).
    const isSubtypeRow = (request.subtype_id ?? null) !== null;
    const priority = isSubtypeRow
      ? ('priority' in request ? (request.priority ?? null) : (existing?.priority ?? null))
      : null;

    if (existing) {
      // Update existing preference
      const [updated] = await tenantScopedTable(trx, 'user_internal_notification_preferences', tenant)
        .where({
          preference_id: existing.preference_id
        })
        .update({
          is_enabled: request.is_enabled,
          priority,
          updated_at: trx.fn.now()
        })
        .returning('*');
      return updated;
    } else {
      // Create new preference
      const [created] = await tenantDb(trx, tenant).table<UserInternalNotificationPreference>('user_internal_notification_preferences')
        .insert({
          tenant,
          user_id: userId,
          category_id: request.category_id || null,
          subtype_id: request.subtype_id || null,
          is_enabled: request.is_enabled,
          priority
        })
        .returning('*');
      return created;
    }
  });
});

/**
 * Check if a user has internal notifications enabled for a specific subtype
 *
 * Only the authenticated user's own preferences are consulted — the
 * caller-supplied tenant/userId arguments are retained for call-site
 * compatibility but ignored in favor of the session.
 */
export const isInternalNotificationEnabledAction = withAuth(async (
  currentUser,
  { tenant },
  _callerTenant: string,
  _callerUserId: string,
  subtypeId: number
): Promise<boolean> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  const userId = currentUser.user_id;

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check for specific subtype preference
    const subtypePreference = await tenantScopedTable(trx, 'user_internal_notification_preferences', tenant)
      .where({
        user_id: userId,
        subtype_id: subtypeId
      })
      .first();

    if (subtypePreference) {
      return subtypePreference.is_enabled;
    }

    // Get the category for this subtype
    const subtype = await tenantScopedTable(trx, 'internal_notification_subtypes', tenant)
      .where({ internal_notification_subtype_id: subtypeId })
      .first();

    if (!subtype) {
      return true; // Default to enabled if subtype not found
    }

    // Check for category-level preference
    const categoryPreference = await tenantScopedTable(trx, 'user_internal_notification_preferences', tenant)
      .where({
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
});

/**
 * Update internal notification category (tenant-specific)
 * Requires 'settings' 'update' permission
 */
export const updateInternalCategoryAction = withAuth(async (
  currentUser,
  { tenant },
  categoryId: number,
  updates: Partial<Pick<InternalNotificationCategory, 'is_enabled' | 'is_default_enabled'>>
): Promise<InternalNotificationCategory | NotificationActionError> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Check permission within transaction context
      const hasUpdatePermission = await hasPermissionAsync(currentUser, 'settings', 'update', trx);
      if (!hasUpdatePermission) {
        throw new Error('Permission denied: Cannot update settings');
      }

      // Verify category exists
      const category = await tenantScopedTable(trx, 'internal_notification_categories', tenant)
        .where({ internal_notification_category_id: categoryId })
        .first();

      if (!category) {
        throw new Error('Category not found');
      }

      // Get existing tenant settings (if any) to preserve values not being updated
      const existingSettings = await tenantScopedTable(trx, 'tenant_internal_notification_category_settings', tenant)
        .where({ category_id: categoryId })
        .first();

      // Build update object with only defined values, defaulting to existing or true
      const is_enabled = updates.is_enabled ?? existingSettings?.is_enabled ?? true;
      const is_default_enabled = updates.is_default_enabled ?? existingSettings?.is_default_enabled ?? true;
      // Compute timestamp before query - CitusDB requires IMMUTABLE values in ON CONFLICT UPDATE
      const now = new Date();

      // Upsert into tenant-specific settings table
      await tenantDb(trx, tenant).table('tenant_internal_notification_category_settings')
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
  } catch (error) {
    const expected = notificationActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Update internal notification subtype (tenant-specific)
 * Requires 'settings' 'update' permission
 */
export const updateInternalSubtypeAction = withAuth(async (
  currentUser,
  { tenant },
  subtypeId: number,
  updates: Partial<Pick<InternalNotificationSubtype, 'is_enabled' | 'is_default_enabled'>> & {
    /** Tenant priority override. `null` clears it (reset to subtype default); `undefined` leaves it unchanged. */
    priority?: InternalNotificationPriority | null;
  }
): Promise<InternalNotificationSubtype | NotificationActionError> => {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Check permission within transaction context
      const hasUpdatePermission = await hasPermissionAsync(currentUser, 'settings', 'update', trx);
      if (!hasUpdatePermission) {
        throw new Error('Permission denied: Cannot update settings');
      }

      // Verify subtype exists
      const subtype = await tenantScopedTable(trx, 'internal_notification_subtypes', tenant)
        .where({ internal_notification_subtype_id: subtypeId })
        .first();

      if (!subtype) {
        throw new Error('Subtype not found');
      }

      // Get existing tenant settings (if any) to preserve values not being updated
      const existingSettings = await tenantScopedTable(trx, 'tenant_internal_notification_subtype_settings', tenant)
        .where({ subtype_id: subtypeId })
        .first();

      // Build update object with only defined values, defaulting to existing or true
      const is_enabled = updates.is_enabled ?? existingSettings?.is_enabled ?? true;
      const is_default_enabled = updates.is_default_enabled ?? existingSettings?.is_default_enabled ?? true;
      // Priority override (task 29.8.46): only touch it when the caller supplied a
      // `priority` key. `null` clears the override; omitting the key preserves it.
      const priority = 'priority' in updates
        ? (updates.priority ?? null)
        : (existingSettings?.priority ?? null);
      // Compute timestamp before query - CitusDB requires IMMUTABLE values in ON CONFLICT UPDATE
      const now = new Date();

      // Upsert into tenant-specific settings table
      await tenantDb(trx, tenant).table('tenant_internal_notification_subtype_settings')
        .insert({
          tenant,
          subtype_id: subtypeId,
          is_enabled,
          is_default_enabled,
          priority
        })
        .onConflict(['tenant', 'subtype_id'])
        .merge({
          is_enabled,
          is_default_enabled,
          priority,
          updated_at: now
        });

      return {
        ...subtype,
        is_enabled,
        is_default_enabled,
        tenant_priority: priority as InternalNotificationPriority | null,
        effective_priority: (priority ?? subtype.default_priority ?? 'normal') as InternalNotificationPriority
      };
    });
  } catch (error) {
    const expected = notificationActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
