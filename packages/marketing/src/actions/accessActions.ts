'use server';

import { withAuth } from '@alga-psa/auth';
import {
  actorId,
  requireMarketingEnabled,
  requireMarketingPermission,
} from '../lib/guards';

export interface MarketingAccess {
  allowed: boolean;
  /** Why access is denied; null when allowed. */
  reason: 'disabled' | 'permission' | null;
}

/**
 * Non-throwing access probe for the marketing pages: lets a server page
 * distinguish "guard failed" (flag off / no permission — render a boundary)
 * from "no data yet" (render the module empty). Actions keep their throwing
 * guards; this only informs what shell to render.
 */
export const getMarketingAccess = withAuth(async (user, { tenant }): Promise<MarketingAccess> => {
  try {
    await requireMarketingEnabled(tenant, actorId(user));
  } catch {
    return { allowed: false, reason: 'disabled' };
  }
  try {
    await requireMarketingPermission(user, 'read');
  } catch {
    return { allowed: false, reason: 'permission' };
  }
  return { allowed: true, reason: null };
});
