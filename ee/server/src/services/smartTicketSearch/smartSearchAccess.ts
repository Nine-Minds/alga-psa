/**
 * The one decision for "may this caller run smart ticket search right now".
 *
 * Both the Tickets page probe (hide the affordance) and the stream route (refuse
 * before spending a token) call this, so the two can never disagree. Checks in
 * order, cheapest first:
 *
 *   1. the caller can read tickets
 *   2. the `release-v1-6-feature` flag is on for this tenant/user
 *   3. the tenant has the AI Assistant add-on
 *   4. a TypeSafe key is configured
 */

import { RELEASE_V1_6_FEATURE_FLAG, isFeatureFlagEnabled } from '@alga-psa/core';
import { hasPermission } from '@alga-psa/auth/rbac';
import { ADD_ONS, type IUserWithRoles } from '@alga-psa/types';
import { AddOnAccessError, assertTenantAddOnAccess } from 'server/src/lib/tier-gating/assertAddOnAccess';

import { isSmartTicketSearchConfigured } from './typesafeClient';

export type SmartSearchDenialReason =
  | 'FORBIDDEN'
  | 'FEATURE_FLAG_OFF'
  | 'ADD_ON_REQUIRED'
  | 'SMART_SEARCH_NOT_CONFIGURED';

export type SmartSearchAccess =
  | { allowed: true }
  | { allowed: false; reason: SmartSearchDenialReason; message: string };

export const SMART_SEARCH_FEATURE_FLAG = RELEASE_V1_6_FEATURE_FLAG;
export const SMART_SEARCH_ADD_ON = ADD_ONS.AI_ASSISTANT;

export async function evaluateSmartTicketSearchAccess(
  user: Pick<IUserWithRoles, 'user_id' | 'tenant'> & Partial<IUserWithRoles>
): Promise<SmartSearchAccess> {
  if (!(await hasPermission(user as IUserWithRoles, 'ticket', 'read'))) {
    return { allowed: false, reason: 'FORBIDDEN', message: 'You do not have permission to view tickets' };
  }

  const flagOn = await isFeatureFlagEnabled(SMART_SEARCH_FEATURE_FLAG, {
    tenantId: user.tenant,
    userId: user.user_id,
  });
  if (!flagOn) {
    return { allowed: false, reason: 'FEATURE_FLAG_OFF', message: 'Smart ticket search is not enabled for this tenant' };
  }

  try {
    await assertTenantAddOnAccess(user.tenant, SMART_SEARCH_ADD_ON);
  } catch (error) {
    if (error instanceof AddOnAccessError) {
      return { allowed: false, reason: 'ADD_ON_REQUIRED', message: error.message };
    }
    throw error;
  }

  if (!(await isSmartTicketSearchConfigured())) {
    return {
      allowed: false,
      reason: 'SMART_SEARCH_NOT_CONFIGURED',
      message: 'Smart ticket search is not configured on this server',
    };
  }

  return { allowed: true };
}
