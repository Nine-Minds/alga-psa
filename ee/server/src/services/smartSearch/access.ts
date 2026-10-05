/**
 * The one decision for "may this caller run smart search on this entity now".
 *
 * Both a list page's availability probe (hide the affordance) and the stream
 * route (refuse before spending a token) call this, so the two can never
 * disagree. Checks in order, cheapest first:
 *
 *   1. the caller can read the entity (`<resource>:read`)
 *   2. the tenant has the AI Assistant add-on
 *   3. a TypeSafe key is configured
 */

import { hasPermission } from '@alga-psa/auth/rbac';
import { ADD_ONS, type IUserWithRoles } from '@alga-psa/types';
import { AddOnAccessError, assertTenantAddOnAccess } from 'server/src/lib/tier-gating/assertAddOnAccess';

import { isSmartSearchConfigured } from './typesafeClient';

export type SmartSearchDenialReason =
  | 'FORBIDDEN'
  | 'ADD_ON_REQUIRED'
  | 'SMART_SEARCH_NOT_CONFIGURED';

export type SmartSearchAccess =
  | { allowed: true }
  | { allowed: false; reason: SmartSearchDenialReason; message: string };

export const SMART_SEARCH_ADD_ON = ADD_ONS.AI_ASSISTANT;

export interface SmartSearchAccessTarget {
  /** RBAC resource whose `read` action gates the search, e.g. `ticket` or `project`. */
  permissionResource: string;
  /** Plural noun for messages, e.g. `tickets`. */
  noun: string;
}

export async function evaluateSmartSearchAccess(
  user: Pick<IUserWithRoles, 'user_id' | 'tenant'> & Partial<IUserWithRoles>,
  target: SmartSearchAccessTarget
): Promise<SmartSearchAccess> {
  if (!(await hasPermission(user as IUserWithRoles, target.permissionResource, 'read'))) {
    return { allowed: false, reason: 'FORBIDDEN', message: `You do not have permission to view ${target.noun}` };
  }

  try {
    await assertTenantAddOnAccess(user.tenant, SMART_SEARCH_ADD_ON);
  } catch (error) {
    if (error instanceof AddOnAccessError) {
      return { allowed: false, reason: 'ADD_ON_REQUIRED', message: error.message };
    }
    throw error;
  }

  if (!(await isSmartSearchConfigured())) {
    return {
      allowed: false,
      reason: 'SMART_SEARCH_NOT_CONFIGURED',
      message: 'Smart search is not configured on this server',
    };
  }

  return { allowed: true };
}
