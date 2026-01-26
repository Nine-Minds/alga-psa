/**
 * Two-Factor Authentication Helper Functions
 *
 * Provides utilities for verifying 2FA codes by fetching user secrets from the database
 * and delegating to the existing authenticator verification logic.
 */

import { getConnection } from 'server/src/lib/db/db';
import { verifyAuthenticator } from 'server/src/utils/authenticator/authenticator';

export async function verifyTwoFactorCode(
  tenant: string,
  userId: string,
  code: string
): Promise<boolean> {
  const knex = await getConnection(tenant);

  const user = await knex('users')
    .where({ tenant, user_id: userId })
    .select('two_factor_enabled', 'two_factor_secret')
    .first();

  if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
    return false;
  }

  return verifyAuthenticator(code, user.two_factor_secret);
}

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
