'use server';

import { getConnection } from 'server/src/lib/db/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

interface InternalNotificationPreference {
  user_id: string;
  internal_notification_type_id: string;
  channel: 'in_app';
  enabled: boolean;
}

export async function getUserInternalNotificationPreferences(userIds: string[], tenantId?: string): Promise<InternalNotificationPreference[]> {
  if (!tenantId) {
    throw new Error('Tenant ID is required for background operations');
  }
  
  const knex = await getConnection(tenantId);
  const tenant = tenantId;

  const preferences = await knex('internal_notification_preferences')
    .whereIn('user_id', userIds)
    .andWhere({ tenant, channel: 'in_app' })
    .select('user_id', 'internal_notification_type_id', 'channel', 'enabled');

  return preferences;
}

export async function setUserInternalNotificationPreference(
  userId: string,
  typeId: string,
  enabled: boolean,
  tenantId?: string
): Promise<void> {
  if (!tenantId) {
    throw new Error('Tenant ID is required for background operations');
  }
  
  const knex = await getConnection(tenantId);
  const tenant = tenantId;

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

export async function getAllInternalNotificationTypes(tenantId?: string): Promise<{ internal_notification_type_id: string; type_name: string; category_name: string }[]> {
    if (!tenantId) {
      throw new Error('Tenant ID is required for background operations');
    }
    
    const knex = await getConnection(tenantId);
    const types = await knex('internal_notification_types')
        .select('internal_notification_type_id', 'type_name', 'category_name')
        .orderBy('category_name', 'asc')
        .orderBy('type_name', 'asc');
    return types;
}