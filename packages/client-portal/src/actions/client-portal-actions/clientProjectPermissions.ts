import type { Knex } from 'knex';
import type { IUser, IUserWithRoles } from '@alga-psa/types';
import { hasPermission } from '@alga-psa/auth';

/**
 * The role-based `project:read` gate for the client portal, which sits on top
 * of the row-level visibility filter (applyProjectVisibilityFilter) rather than
 * replacing it: a portal role with every project permission unchecked reads no
 * projects at all, whatever the row scoping would have allowed.
 */
export async function hasClientProjectReadPermission(
  connection: Knex | Knex.Transaction,
  user: IUserWithRoles,
  tenant: string,
): Promise<boolean> {
  return hasPermission(
    {
      user_id: user.user_id,
      email: user.email,
      user_type: 'client',
      is_inactive: false,
      tenant,
    } as IUser,
    'project',
    'read',
    connection,
  );
}
