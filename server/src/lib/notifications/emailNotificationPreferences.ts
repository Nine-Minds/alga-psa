import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { resolveEmailPreferenceEnabled } from '@alga-psa/notifications';

export interface EmailNotificationPreferenceResult {
  enabled: boolean;
  subtypeId?: number;
}

/**
 * Shared email preference gate for event subscribers.
 *
 * Administrator and tenant settings win, then the recipient's personal
 * preference is applied. This mirrors the effective email preference state
 * used by the notification settings UI.
 */
export async function resolveEmailNotificationPreference(
  knex: Knex,
  tenantId: string,
  subtypeName: string,
  userId?: string | null,
): Promise<EmailNotificationPreferenceResult> {
  const db = tenantDb(knex, tenantId);

  const settings = await db.table('notification_settings').first('is_enabled');
  const subtype = await db.table('notification_subtypes')
    .where({ name: subtypeName })
    .first('id', 'category_id', 'is_enabled');
  if (!subtype) {
    return { enabled: false };
  }

  const category = await db.table('notification_categories')
    .where({ id: subtype.category_id })
    .first('is_enabled');
  const subtypeSetting = await db.table('tenant_notification_subtype_settings')
    .where({ subtype_id: subtype.id })
    .first('is_enabled');
  const categorySetting = await db.table('tenant_notification_category_settings')
    .where({ category_id: subtype.category_id })
    .first('is_enabled');

  let personalEnabled: boolean | undefined;
  if (userId) {
    const preference = await db.table('user_notification_preferences')
      .where({ user_id: userId, subtype_id: subtype.id })
      .first('is_enabled');
    personalEnabled = preference?.is_enabled;
  }

  const enabled = resolveEmailPreferenceEnabled(
    settings?.is_enabled,
    categorySetting?.is_enabled ?? category?.is_enabled,
    subtypeSetting?.is_enabled ?? subtype.is_enabled,
    personalEnabled,
  );
  return enabled ? { enabled: true, subtypeId: subtype.id } : { enabled: false };
}
