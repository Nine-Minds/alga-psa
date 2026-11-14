import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { hasPermission } from './rbac';

/**
 * Commercial lookups (the service catalog with its rates, and the contract lines a client can be
 * billed against) are readable only by an internal user who holds one of these permissions.
 *
 * `hasPermission` alone is not enough: a client-portal Admin holds `billing:read` in the portal
 * scope. The `user_type` check keeps a portal principal out regardless of the roles it carries.
 * A seat technician is an internal user whose role (`CO_MANAGED_SEAT_ROLE_GRANTS`) names neither
 * permission, so it is refused here without this module knowing the seat role exists.
 */
export const COMMERCIAL_READ_PERMISSIONS: ReadonlyArray<{ resource: string; action: string }> = [
  { resource: 'service', action: 'read' },
  { resource: 'billing', action: 'read' },
];

export const COMMERCIAL_READ_DENIED_MESSAGE =
  'Permission denied: service or billing read required';

export async function hasCommercialReadPermission(
  user: IUser,
  knexConnection?: Knex | Knex.Transaction,
): Promise<boolean> {
  if (user.user_type !== 'internal') return false;
  for (const { resource, action } of COMMERCIAL_READ_PERMISSIONS) {
    if (await hasPermission(user, resource, action, knexConnection)) return true;
  }
  return false;
}

/** Throws unless `user` is an internal user holding a commercial read permission. */
export async function assertCommercialReadPermission(
  user: IUser,
  knexConnection?: Knex | Knex.Transaction,
): Promise<void> {
  if (!(await hasCommercialReadPermission(user, knexConnection))) {
    throw new Error(COMMERCIAL_READ_DENIED_MESSAGE);
  }
}
