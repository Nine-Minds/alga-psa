import type { Knex } from 'knex';
import { getConnection, tenantDb, withTransaction } from '@alga-psa/db';
import { withCoManagedStoredPresentation } from './coManagedStoredPresentation';
import type { InternalNotification } from '../types/internalNotification';
import { getNotificationTemplate, renderTemplate, checkInternalNotificationEnabled } from '../actions/internal-notification-actions/createNotificationCore';
import { coManagedNotificationPredicate } from './coManagedNotificationClassification';

export type NotificationDeliveryLocator = Pick<InternalNotification, 'tenant' | 'user_id' | 'internal_notification_id' | 'metadata'>;

function hasSharedMarker(metadata: unknown): boolean {
  return Boolean(metadata && typeof metadata === 'object' && Object.prototype.hasOwnProperty.call(metadata, 'coManaged'));
}

/** Queue payloads identify work; they do not authorize cached content. All
 * channel adapters must await their delivery inside this callback. */
export async function withNotificationDelivery<T>(db: Knex, queued: NotificationDeliveryLocator,
  deliver: (notification: InternalNotification) => Promise<T>): Promise<T | null> {
  const identity = { tenant: queued.tenant, userId: queued.user_id, id: queued.internal_notification_id };
  const queuedShared = hasSharedMarker(queued.metadata);
  return withTransaction(db, async trx => {
    const home = tenantDb(trx, identity.tenant);
    const source = () => home.table('internal_notifications').where({ internal_notification_id: identity.id, user_id: identity.userId }).whereNull('deleted_at');
    const row = await source().first();
    if (!row) return null;
    // Classify by receipt independently of recipient/metadata, so a damaged or
    // stripped marker can never turn shared cached text into an ordinary row.
    const qualified = await source().whereRaw('?', [coManagedNotificationPredicate(trx)]).first('internal_notification_id');
    if (queuedShared || qualified) {
      return withCoManagedStoredPresentation(trx, { kind: 'notification_recipient', tenant: identity.tenant, userId: identity.userId }, identity.id,
        async current => {
          const template = await getNotificationTemplate(trx, identity.tenant, current.templateName, current.languageCode);
          if (!template || !await checkInternalNotificationEnabled(trx, identity.tenant, identity.userId, template.subtype_id)) return null;
          const presentation = current.presentation;
          // The verifier already holds the notification lock. Reload current
          // non-content fields too (read state, category, priority, timestamps).
          const locked = await source().first();
          if (!locked) return null;
          return deliver({ ...locked, title: renderTemplate(template.title, presentation.data),
            message: renderTemplate(template.message, presentation.data), link: presentation.link, metadata: presentation.metadata,
            template_name: template.name, language_code: template.language_code });
        });
    }
    const locked = await source().forShare().first();
    if (!locked || hasSharedMarker(locked.metadata)) return null;
    return deliver(locked);
  });
}

export async function deliverCurrentNotification<T>(notification: InternalNotification,
  deliver: (notification: InternalNotification) => Promise<T>): Promise<T | null> {
  const db = await getConnection(notification.tenant);
  return withNotificationDelivery(db, notification, deliver);
}
