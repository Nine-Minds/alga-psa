import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export async function coManagedInternalEmailRecipient(context: { trx: Knex.Transaction; actor: { tenant: string; userId: string } }, subtypeName: 'Ticket Comment Added' | 'Ticket Closed' | 'Task Comment Added' | 'SLA Warning' | 'SLA Breach' = 'Ticket Comment Added') {
  const home = tenantDb(context.trx, context.actor.tenant);
  const user = await home.table('users').where({ user_id: context.actor.userId, user_type: 'internal', is_inactive: false }).forShare().first('email');
  if (!user || typeof user.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email.trim())) return null;
  const settings = await coManagedCommentEmailSettings(context.trx, context.actor.tenant, subtypeName);
  if (!settings) return null;
  if (settings.subtypeId !== undefined && (await home.table('user_notification_preferences')
    .where({ user_id: context.actor.userId, subtype_id: settings.subtypeId }).forShare().first('is_enabled'))?.is_enabled === false) return null;
  return { email: user.email.trim(), ...settings };
}

/** Requesters share tenant notification gates, without borrowing an internal
 * user's preferences or requiring a portal account. */
export async function coManagedCommentEmailSettings(trx: Knex.Transaction, tenant: string, subtypeName: 'Ticket Comment Added' | 'Ticket Closed' | 'Task Comment Added' | 'SLA Warning' | 'SLA Breach' = 'Ticket Comment Added') {
  const home = tenantDb(trx, tenant);
  const settings = await home.table('notification_settings').forShare().first('is_enabled');
  if (settings?.is_enabled === false) return null;
  const subtype = await home.table('notification_subtypes').where('name', subtypeName).forShare().first('id', 'category_id');
  if (subtype) {
    for (const [table, where] of [
      ['tenant_notification_subtype_settings', { subtype_id: subtype.id }],
      ['tenant_notification_category_settings', { category_id: subtype.category_id }],
    ] as const) if ((await home.table(table).where(where).forShare().first('is_enabled'))?.is_enabled === false) return null;
  }
  return { subtypeId: subtype?.id as number | undefined };
}
