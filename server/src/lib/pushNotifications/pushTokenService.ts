import { tenantDb } from '@alga-psa/db';
import { getConnection } from '../db/db';
import logger from '@alga-psa/core/logger';

interface PushTokenRow {
  mobile_push_token_id: string;
  expo_push_token: string;
  device_id: string;
  platform: string;
}

export async function upsertPushToken(
  tenant: string,
  userId: string,
  deviceId: string,
  expoPushToken: string,
  platform: string,
  appVersion?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const db = tenantDb(await getConnection(tenant), tenant);
  await db.table('mobile_push_tokens')
    .insert({
      tenant,
      user_id: userId,
      device_id: deviceId,
      expo_push_token: expoPushToken,
      platform,
      app_version: appVersion ?? null,
      is_active: true,
      updated_at: now,
      last_used_at: now,
    })
    .onConflict(['tenant', 'user_id', 'device_id'])
    .merge({
      expo_push_token: expoPushToken,
      platform,
      app_version: appVersion ?? null,
      is_active: true,
      updated_at: now,
      last_used_at: now,
    });
}

export async function deactivatePushToken(
  tenant: string,
  userId: string,
  deviceId: string,
): Promise<void> {
  const db = tenantDb(await getConnection(tenant), tenant);
  await db.table('mobile_push_tokens')
    .where({ user_id: userId, device_id: deviceId })
    .update({ is_active: false, updated_at: new Date().toISOString() });
}

export async function getActivePushTokensForUser(
  tenant: string,
  userId: string,
): Promise<PushTokenRow[]> {
  const db = tenantDb(await getConnection(tenant), tenant);
  return db.table('mobile_push_tokens')
    .select('mobile_push_token_id', 'expo_push_token', 'device_id', 'platform')
    .where({ user_id: userId, is_active: true });
}

export async function deactivateInvalidTokens(
  tenant: string,
  expoPushTokens: string[],
): Promise<void> {
  if (expoPushTokens.length === 0) return;
  const db = tenantDb(await getConnection(tenant), tenant);
  await db.table('mobile_push_tokens')
    .whereIn('expo_push_token', expoPushTokens)
    .update({ is_active: false, updated_at: new Date().toISOString() });

  logger.info('[PushTokenService] Deactivated invalid tokens', {
    tenant,
    count: expoPushTokens.length,
  });
}
