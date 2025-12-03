/**
 * Two-Factor Authentication Helper Functions
 *
 * Provides utilities for verifying 2FA codes by fetching user secrets from the database
 * and delegating to the existing authenticator verification logic.
 */

import { getConnection } from 'server/src/lib/db/db';
import { verifyAuthenticator } from 'server/src/utils/authenticator/authenticator';

/**
 * Verify a 2FA code for a user by fetching their secret from the database
 * This wraps the existing verifyAuthenticator() function
 *
 * @param tenant - Tenant ID
 * @param userId - User ID
 * @param code - 6-digit TOTP code from authenticator app
 * @returns true if code is valid, false otherwise
 */
export async function verifyTwoFactorCode(
  tenant: string,
  userId: string,
  code: string
): Promise<boolean> {
  const knex = await getConnection(tenant);

  // Fetch user's 2FA secret
  const user = await knex('users')
    .where({ tenant, user_id: userId })
    .select('two_factor_enabled', 'two_factor_secret')
    .first();

  // Check if 2FA is enabled
  if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
    return false;
  }

  // Verify the code using the existing authenticator function
  return verifyAuthenticator(code, user.two_factor_secret);
}

/**
 * Check if a user has 2FA enabled
 *
 * @param tenant - Tenant ID
 * @param userId - User ID
 * @returns true if 2FA is enabled, false otherwise
 */
export async function isTwoFactorEnabled(
  tenant: string,
  userId: string
): Promise<boolean> {
  const knex = await getConnection(tenant);

  const user = await knex('users')
    .where({ tenant, user_id: userId })
    .select('two_factor_enabled')
    .first();

  return user?.two_factor_enabled || false;
}
