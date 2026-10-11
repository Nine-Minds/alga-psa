import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedSlaNotification, type CoManagedSlaNotification } from './slaNotification';
import type { CoManagedNotificationRecipient, CoManagedNotificationRecipientContext } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';

export interface CoManagedStoredSlaNotification {
  templateName: string;
  languageCode: string;
  message: CoManagedSlaNotification;
}
export async function withCoManagedStoredSlaNotification<T>(db: Knex, input: CoManagedSessionActor | CoManagedNotificationRecipient,
  notificationId: string, consume: (context: CoManagedNotificationRecipientContext, current: CoManagedStoredSlaNotification) => Promise<T>,
  options: { notificationLock?: 'share' | 'update' } = {}): Promise<T | null> {
  if (!input || ![input.tenant, input.userId, notificationId].every(isCoManagedUuid) || !['session', 'notification_recipient'].includes(input.kind) ||
      !['share', 'update'].includes(options.notificationLock ?? 'share')) throw new CoManagedSharedWorkError();
  const actor = input.kind === 'session' ? snapshotCoManagedSessionActor(input) : { kind: 'notification_recipient' as const, tenant: input.tenant, userId: input.userId };
  const receipt = await tenantDb(db, actor.tenant).table('sla_organization_notification_recipients')
    .where({ notification_id: notificationId, recipient_user_id: actor.userId, channel: 'in_app', status: 'created' }).first('notification_event_id');
  if (!receipt) return null;
  return withCoManagedSlaNotification(db, actor, receipt.notification_event_id, 'in_app', async (context, message) => {
    const home = tenantDb(context.trx, actor.tenant);
    if (!await home.table('sla_organization_notification_recipients').where({ notification_event_id: message.eventId,
      recipient_user_id: actor.userId, channel: 'in_app', status: 'created', notification_id: notificationId }).forShare().first()) return null;
    const query = home.table('internal_notifications').where({ internal_notification_id: notificationId, user_id: actor.userId }).whereNull('deleted_at');
    if (options.notificationLock === 'update') query.forUpdate(); else query.forShare();
    const row = await query.first('template_name', 'language_code', 'metadata');
    const marker = row?.metadata?.coManaged;
    if (!marker || marker.version !== 3 || marker.kind !== 'sla' || marker.eventId !== message.eventId || marker.obligationId !== message.obligationId ||
        marker.resource?.tenant !== message.resource.tenant || marker.resource?.relationshipId !== message.resource.relationshipId ||
        marker.resource?.kind !== 'ticket' || marker.resource?.id !== message.resource.id || row.template_name !== `sla-${message.notificationType}`) return null;
    if (actor.kind === 'session') await assertCoManagedSessionUnexpired(context.trx, actor);
    return consume(context, { templateName: row.template_name, languageCode: row.language_code, message });
  });
}
