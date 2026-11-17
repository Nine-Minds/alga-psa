import User from '@alga-psa/db/models/user';
import { getAdminConnection } from '@alga-psa/db/admin';
import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { isInteractiveUserType, type IUser } from '@alga-psa/types';

import { getInfoFromToken } from '../tokenizer';
import { toResolvedSubject } from './subject';
import type { ResetUserType, ResolvedResetSubject } from './types';

const sameEmail = (a: string | undefined | null, b: string | undefined | null) =>
  Boolean(a && b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();

/**
 * Redemption-time resolution: the user a reset token was minted for, or null.
 * Null means "invalid token" and is deliberately indistinguishable to callers.
 */
export async function resolveResetSubjectFromToken(token: string): Promise<ResolvedResetSubject | null> {
  const { errorType, userInfo } = await getInfoFromToken(token);
  if (errorType || !userInfo?.email) {
    return null;
  }
  const userType = userInfo.user_type;
  if (!isInteractiveUserType(userType)) {
    logger.warn('[passwordReset] Token has no interactive user_type');
    return null;
  }

  let user: IUser | undefined;
  if (userInfo.tenant && userInfo.user_id) {
    try {
      const db = await getAdminConnection();
      user = await tenantDb(db, userInfo.tenant).table<IUser>('users')
        .where({ user_id: userInfo.user_id })
        .first();
    } catch (error) {
      logger.warn('[passwordReset] Could not load the token subject', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  } else if (userInfo.tenant || userInfo.user_id) {
    // Half a binding is not a binding.
    return null;
  } else {
    // Legacy token (minted before tokens named their user): only unambiguous
    // when exactly one user in all tenants has this email and type. Ambiguity
    // is exactly the case that used to write to the wrong tenant.
    // TODO: delete this branch once pre-binding tokens (1h lifetime) have expired in all deployments.
    const matches = await User.findUsersByEmailAndType(userInfo.email, userType);
    if (matches.length !== 1) {
      logger.warn('[passwordReset] Legacy reset token is ambiguous or matches no user', { matches: matches.length });
      return null;
    }
    user = matches[0];
  }

  if (
    !user ||
    user.is_inactive ||
    !isInteractiveUserType(user.user_type) ||
    user.user_type !== userType ||
    !sameEmail(user.email, userInfo.email)
  ) {
    return null;
  }
  return toResolvedSubject(user, userType as ResetUserType);
}
