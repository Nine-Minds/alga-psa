import { createHmac } from 'crypto';
import User from '@alga-psa/db/models/user';
import { hashPassword, verifyPassword } from 'server/src/utils/encryption/encryption';
import { getSecret } from 'server/src/lib/utils/getSecret';

const DEV_LOGIN_EMAIL = 'glinda@emeraldcity.oz';

/**
 * Return the same high-entropy development password in every local server
 * instance connected to the shared development database. Startup previously
 * generated a different random password in every process, so the last process
 * to initialize silently invalidated credentials printed by earlier servers.
 */
async function getDevelopmentPassword(tenant: string, userId: string): Promise<string> {
  const key = await getSecret('credential_encryption_key', 'CREDENTIAL_ENCRYPTION_KEY');
  if (key.length < 32) {
    throw new Error('Development login requires a shared credential encryption key of at least 32 characters');
  }

  return createHmac('sha256', key)
    .update(`alga-dev-login-v1\n${tenant}\n${userId}`)
    .digest('base64url');
}

export async function provisionDevelopmentLogin(): Promise<{ email: string; password: string } | null> {
  // Match the lookup used by authenticateUser for an internal account.
  const user = await User.findUserByEmailAndType(DEV_LOGIN_EMAIL, 'internal');
  if (!user?.user_id || !user.tenant) {
    return null;
  }

  const password = await getDevelopmentPassword(user.tenant, user.user_id);
  const hashedPassword = await hashPassword(password);
  await User.updatePassword(user.user_id, user.tenant, hashedPassword);

  // Do not print credentials unless the exact tenant-scoped row now accepts
  // them through the same password verifier used by authentication.
  const persisted = await User.findUserByEmailTenantAndType(DEV_LOGIN_EMAIL, user.tenant, 'internal');
  if (
    !persisted ||
    persisted.user_id !== user.user_id ||
    !persisted.hashed_password ||
    !(await verifyPassword(password, persisted.hashed_password))
  ) {
    throw new Error('Development login password was not persisted for the intended account');
  }

  return { email: persisted.email, password };
}
