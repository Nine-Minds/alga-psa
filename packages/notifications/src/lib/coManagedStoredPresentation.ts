import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { readCoManagedStoredCommentNotification, withCoManagedStoredCommentNotification, withCoManagedStoredSlaNotification,
  type CoManagedNotificationRecipient, type CoManagedSessionActor } from '@alga-psa/co-managed';
import { coManagedCommentPresentation } from './coManagedCommentPresentation';
import { coManagedSlaPresentation } from './coManagedSlaPresentation';

interface StoredPresentation {
  templateName: string;
  languageCode: string;
  presentation: ReturnType<typeof coManagedCommentPresentation> | ReturnType<typeof coManagedSlaPresentation>;
}
/** Inbox and channel delivery use the same source dispatcher. The owning
 * transaction retains authority through the caller's render/delivery callback. */
export async function withCoManagedStoredPresentation<T>(trx: Knex.Transaction, actor: CoManagedSessionActor | CoManagedNotificationRecipient,
  notificationId: string, consume: (current: StoredPresentation) => Promise<T>, options: { notificationLock?: 'share' | 'update' } = {}): Promise<T | null> {
  if (!trx.isTransaction) throw new Error('Shared notification rendering requires the owning transaction');
  const sla = await tenantDb(trx, actor.tenant).table('sla_organization_notification_recipients').where('notification_id', notificationId).first('notification_event_id');
  if (sla) return withCoManagedStoredSlaNotification(trx, actor, notificationId, (_context, current) => consume({
    templateName: current.templateName, languageCode: current.languageCode, presentation: coManagedSlaPresentation(current.message),
  }), options);
  if (actor.kind === 'session') {
    const current = await readCoManagedStoredCommentNotification(trx, actor, notificationId, options);
    return current ? consume({ templateName: current.templateName, languageCode: current.languageCode,
      presentation: coManagedCommentPresentation(current.message, current.eventId, current.deliveryKey) }) : null;
  }
  return withCoManagedStoredCommentNotification(trx, actor, notificationId, (_context, current) => consume({
    templateName: current.templateName, languageCode: current.languageCode,
    presentation: coManagedCommentPresentation(current.message, current.eventId, current.deliveryKey),
  }));
}
