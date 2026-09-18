import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { NotificationCategory, NotificationSubtype, UserEmailPreferenceCategoryState, UserNotificationPreference } from '../types/notification';
import { resolveEmailPreferenceEnabled } from './emailPreferenceState';

type PreferenceTarget = { kind: 'category' | 'subtype'; id: number; enabled: boolean };

/** All queries, including validation and the returned snapshot, use the caller's transaction. */
export async function readUserEmailPreferenceState(
  trx: Knex.Transaction, tenant: string, userId: string,
): Promise<UserEmailPreferenceCategoryState[]> {
  const db = tenantDb(trx, tenant);
  const settings = await db.table('notification_settings').first('is_enabled');
  const categoryQuery = db.table('notification_categories as nc');
  db.tenantJoin(categoryQuery, 'tenant_notification_category_settings as tcs', 'tcs.category_id', 'nc.id', {
    type: 'left', tenantPredicate: 'literal',
  });
  const categories = await categoryQuery.select('nc.*',
    trx.raw('COALESCE(tcs.is_enabled, true) as is_enabled'),
    trx.raw('COALESCE(tcs.is_default_enabled, true) as is_default_enabled'),
  ).orderBy('nc.name') as NotificationCategory[];

  const subtypeQuery = db.table('notification_subtypes as ns');
  db.tenantJoin(subtypeQuery, 'tenant_notification_subtype_settings as tss', 'tss.subtype_id', 'ns.id', {
    type: 'left', tenantPredicate: 'literal',
  });
  const subtypes = await subtypeQuery.select('ns.*',
    trx.raw('COALESCE(tss.is_enabled, true) as is_enabled'),
    trx.raw('COALESCE(tss.is_default_enabled, true) as is_default_enabled'),
  ).orderBy('ns.name') as NotificationSubtype[];
  const preferences = await db.table('user_notification_preferences')
    .where({ user_id: userId }).select('subtype_id', 'is_enabled');
  const overrides = new Map<number, boolean>(preferences.map(row => [row.subtype_id, row.is_enabled]));

  return categories.map(category => ({
    ...category,
    is_enabled: resolveEmailPreferenceEnabled(settings?.is_enabled, category.is_enabled, true, true),
    subtypes: subtypes.filter(subtype => subtype.category_id === category.id).map(subtype => ({
      ...subtype,
      has_user_override: overrides.has(subtype.id),
      user_is_enabled: overrides.get(subtype.id) ?? true,
      effective_is_enabled: resolveEmailPreferenceEnabled(
        settings?.is_enabled, category.is_enabled, subtype.is_enabled, overrides.get(subtype.id),
      ),
    })),
  }));
}

export async function saveUserEmailPreferences(
  knex: Knex, tenant: string, userId: string, target: PreferenceTarget,
): Promise<{ state: UserEmailPreferenceCategoryState[]; preferences: UserNotificationPreference[] }> {
  if (!Number.isSafeInteger(target.id) || target.id <= 0 || typeof target.enabled !== 'boolean') {
    throw new Error('Invalid email preference');
  }
  return withTransaction(knex, async trx => {
    const state = await readUserEmailPreferenceState(trx, tenant, userId);
    const category = state.find(category => target.kind === 'category'
      ? category.id === target.id
      : category.subtypes.some(subtype => subtype.id === target.id));
    if (!category) throw new Error(target.kind === 'category' ? 'Category not found' : 'Subtype not found');
    const selected = category.subtypes.filter(subtype => target.kind === 'category' || subtype.id === target.id);
    if (!category.is_enabled || (target.kind === 'subtype' && !selected[0]?.is_enabled)) {
      throw new Error('Notification disabled by administrator');
    }
    const eligible = selected.filter(subtype => subtype.is_enabled);
    let preferences: UserNotificationPreference[] = [];
    if (eligible.length) {
      // Literal timestamps also work with Citus ON CONFLICT updates.
      const now = new Date().toISOString();
      preferences = await tenantDb(trx, tenant).table('user_notification_preferences').insert(eligible.map(subtype => ({
        tenant, user_id: userId, subtype_id: subtype.id, is_enabled: target.enabled, updated_at: now,
      }))).onConflict(['tenant', 'user_id', 'subtype_id']).merge(['is_enabled', 'updated_at']).returning('*') as UserNotificationPreference[];
    }
    return { state: await readUserEmailPreferenceState(trx, tenant, userId), preferences };
  });
}
