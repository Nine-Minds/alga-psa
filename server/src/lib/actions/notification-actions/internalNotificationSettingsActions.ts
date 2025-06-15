'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

interface InternalNotificationPreference {
  user_id: string;
  internal_notification_type_id: string;
  channel: 'in_app';
  enabled: boolean;
}

export async function getUserInternalNotificationPreferences(userIds: string[]): Promise<InternalNotificationPreference[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const preferences = await knex('internal_notification_preferences')
    .whereIn('user_id', userIds)
    .andWhere({ tenant, channel: 'in_app' })
    .select('user_id', 'internal_notification_type_id', 'channel', 'enabled');

  return preferences;
}

export async function setUserInternalNotificationPreference(
  userId: string,
  typeId: string,
  enabled: boolean
): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const preference = {
      tenant,
      user_id: userId,
      internal_notification_type_id: typeId,
      channel: 'in_app',
      enabled,
    };

    await trx('internal_notification_preferences')
      .insert(preference)
      .onConflict(['tenant', 'user_id', 'internal_notification_type_id', 'channel'])
      .merge();
  });
}

export async function getAllInternalNotificationTypes(): Promise<{ internal_notification_type_id: string; type_name: string; category_name: string }[]> {
    const { knex } = await createTenantKnex();
    const types = await knex('internal_notification_types')
        .select('internal_notification_type_id', 'type_name', 'category_name')
        .orderBy('category_name', 'asc')
        .orderBy('type_name', 'asc');
    return types;
}