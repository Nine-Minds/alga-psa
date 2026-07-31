import { hasPermission } from '@alga-psa/auth';
import { isFeatureFlagEnabled } from '@alga-psa/core';

export const MARKETING_MODULE_FLAG = 'marketing-module';

export type MarketingPermissionAction = 'read' | 'manage';

/** Throws unless the user holds marketing:{action} (resource 'marketing'). */
export async function requireMarketingPermission(
  user: unknown,
  action: MarketingPermissionAction,
): Promise<void> {
  if (!await hasPermission(user as any, 'marketing', action)) {
    throw new Error(`Permission denied: marketing ${action} required`);
  }
}

/** Throws unless the marketing-module feature flag is on for this tenant. */
export async function requireMarketingEnabled(tenantId: string, userId?: string): Promise<void> {
  const enabled = await isFeatureFlagEnabled(MARKETING_MODULE_FLAG, { tenantId, userId });
  if (!enabled) {
    throw new Error('Marketing module is not enabled for this tenant');
  }
}

export function actorId(user: unknown): string {
  const id = (user as { user_id?: string } | null)?.user_id;
  if (!id) throw new Error('user is not logged in');
  return id;
}

/** Standard action guard: flag on + permission held. Returns the actor id. */
export async function guardMarketing(
  user: unknown,
  tenant: string,
  action: MarketingPermissionAction,
): Promise<string> {
  const userId = actorId(user);
  await requireMarketingEnabled(tenant, userId);
  await requireMarketingPermission(user, action);
  return userId;
}
