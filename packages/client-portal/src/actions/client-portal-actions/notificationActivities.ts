'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  ActivityFilters,
  ActivityPriority,
  ActivityType,
  NotificationActivity,
} from '@alga-psa/types';

function getNotificationPriority(type: string | null | undefined): ActivityPriority {
  switch (type) {
    case 'error':
      return ActivityPriority.HIGH;
    case 'warning':
      return ActivityPriority.MEDIUM;
    default:
      return ActivityPriority.LOW;
  }
}

function toIsoString(value: unknown): string {
  const parsed = value ? new Date(value as string | number | Date) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export const fetchNotificationActivities = withAuth(async (
  user,
  { tenant },
  filters: ActivityFilters = {},
): Promise<NotificationActivity[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const notifications = await trx('internal_notifications')
      .where('tenant', tenant)
      .where('user_id', user.user_id)
      .whereNull('deleted_at')
      .modify((queryBuilder) => {
        if (filters.isClosed === false) {
          queryBuilder.where('is_read', false);
        } else if (filters.isClosed === true) {
          queryBuilder.where('is_read', true);
        }

        if (filters.search) {
          queryBuilder.where('category', filters.search);
        }

        if (filters.dateRangeStart) {
          queryBuilder.where('created_at', '>=', filters.dateRangeStart);
        }

        if (filters.dateRangeEnd) {
          queryBuilder.where('created_at', '<=', filters.dateRangeEnd);
        }
      })
      .orderBy('created_at', 'desc');

    const activities: NotificationActivity[] = notifications.map((notification: any): NotificationActivity => ({
      id: String(notification.internal_notification_id),
      title: notification.title,
      description: notification.message,
      type: ActivityType.NOTIFICATION,
      status: notification.type || 'info',
      priority: getNotificationPriority(notification.type),
      assignedTo: notification.user_id ? [notification.user_id] : [],
      sourceId: String(notification.internal_notification_id),
      sourceType: ActivityType.NOTIFICATION,
      notificationId: notification.internal_notification_id,
      templateName: notification.template_name,
      message: notification.message,
      isRead: Boolean(notification.is_read),
      readAt: notification.read_at ?? undefined,
      link: notification.link ?? undefined,
      metadata: notification.metadata ?? undefined,
      category: notification.category ?? undefined,
      actions: [
        { id: 'view', label: 'View Details' },
        { id: 'mark-read', label: notification.is_read ? 'Mark Unread' : 'Mark Read' },
      ],
      tenant: notification.tenant,
      createdAt: toIsoString(notification.created_at),
      updatedAt: toIsoString(notification.updated_at),
    }));

    if (!filters.priority?.length) {
      return activities;
    }

    const allowed = new Set(filters.priority);
    return activities.filter((activity: NotificationActivity) => allowed.has(activity.priority));
  });
});
