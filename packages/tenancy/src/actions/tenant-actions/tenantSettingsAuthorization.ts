import { getConnection } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';

/** Check tenant settings authority using the authenticated action context. */
export async function hasTenantSettingsUpdate(
  user: IUserWithRoles,
  tenant: string,
): Promise<boolean> {
  if (!tenant || user.tenant !== tenant) {
    return false;
  }

  try {
    const knex = await getConnection(tenant);
    return await hasPermission(user, 'settings', 'update', knex);
  } catch {
    // Permission lookup failures must never grant a settings mutation.
    return false;
  }
}

export async function requireTenantSettingsUpdate(
  user: IUserWithRoles,
  tenant: string,
): Promise<void> {
  if (!(await hasTenantSettingsUpdate(user, tenant))) {
    throw new Error('Permission denied: Cannot update settings');
  }
}
