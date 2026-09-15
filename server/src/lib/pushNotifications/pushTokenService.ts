import { tenantDb } from '@alga-psa/db';
import { getConnection } from '../db/db';
import logger from '@alga-psa/core/logger';

export type PushPriority = 'high' | 'normal' | 'low';

export interface PushTokenRow {
  mobile_push_token_id: string;
  expo_push_token: string;
  device_id: string;
  platform: string;
  /** Lowest notification priority this device wants pushed ('low' = everything). */
  push_priority_threshold: PushPriority;
}

const PRIORITY_RANK: Record<PushPriority, number> = { low: 0, normal: 1, high: 2 };

/** True when a notification of `priority` should be pushed to a device with `threshold`. */
export function meetsPushPriorityThreshold(
  priority: PushPriority | null | undefined,
  threshold: PushPriority | null | undefined,
): boolean {
  return PRIORITY_RANK[priority ?? 'normal'] >= PRIORITY_RANK[threshold ?? 'low'];
}

export async function upsertPushToken(
  tenant: string,
  userId: string,
  deviceId: string,
  expoPushToken: string,
  platform: string,
  appVersion?: string,
  priorityThreshold?: PushPriority,
): Promise<void> {
  const now = new Date().toISOString();
  const db = tenantDb(await getConnection(tenant), tenant);
  const thresholdPatch = priorityThreshold ? { push_priority_threshold: priorityThreshold } : {};
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
      ...thresholdPatch,
    })
    .onConflict(['tenant', 'user_id', 'device_id'])
    .merge({
      expo_push_token: expoPushToken,
      platform,
      app_version: appVersion ?? null,
      is_active: true,
      updated_at: now,
      last_used_at: now,
      // A re-register without a threshold keeps whatever the device set before.
      ...thresholdPatch,
    });
}

export async function updatePushPriorityThreshold(
  tenant: string,
  userId: string,
  deviceId: string,
  priorityThreshold: PushPriority,
): Promise<boolean> {
  const db = tenantDb(await getConnection(tenant), tenant);
  const updated = await db.table('mobile_push_tokens')
    .where({ user_id: userId, device_id: deviceId })
    .update({ push_priority_threshold: priorityThreshold, updated_at: new Date().toISOString() });
  return updated > 0;
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
    .select('mobile_push_token_id', 'expo_push_token', 'device_id', 'platform', 'push_priority_threshold')
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
