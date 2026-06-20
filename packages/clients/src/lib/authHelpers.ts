/**
 * Auth helpers for clients package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * clients -> auth -> ... -> clients
 */

import type { IRole } from '@alga-psa/types';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';

type DbConnection = Knex | Knex.Transaction;
type PermissionResource = 'client' | 'contact' | 'interaction' | 'document' | 'user' | 'system_settings' | string;
type UserWithClientContext = IUserWithRoles & { clientId?: string | null };

export async function hasPermissionAsync(user: any, resource: string, action: string, trx?: any): Promise<boolean> {
  const module = await import('@alga-psa/auth');
  return module.hasPermission(user, resource, action, trx);
}

export function isMspUser(user: Pick<IUserWithRoles, 'user_type'> | null | undefined): boolean {
  return user?.user_type === 'internal';
}

export function isClientPortalUser(user: Pick<IUserWithRoles, 'user_type'> | null | undefined): boolean {
  return user?.user_type === 'client';
}

export async function hasMspPermission(
  user: IUserWithRoles,
  resource: PermissionResource,
  action: string,
  trx?: DbConnection
): Promise<boolean> {
  if (!isMspUser(user)) {
    return false;
  }

  return hasPermissionAsync(user, resource, action, trx);
}

export async function assertMspPermission(
  user: IUserWithRoles,
  resource: PermissionResource,
  action: string,
  message: string,
  trx?: DbConnection
): Promise<void> {
  if (!await hasMspPermission(user, resource, action, trx)) {
    throw new Error(message);
  }
}

export async function getContactClientId(
  db: DbConnection,
  tenant: string,
  contactId: string
): Promise<string | null> {
  const contact = await db('contacts')
    .select('client_id')
    .where({
      contact_name_id: contactId,
      tenant
    })
    .first();

  return typeof contact?.client_id === 'string' ? contact.client_id : null;
}

export async function getClientPortalUserClientId(
  user: UserWithClientContext,
  tenant: string,
  db?: DbConnection
): Promise<string | null> {
  if (!isClientPortalUser(user)) {
    return null;
  }

  if (typeof user.clientId === 'string' && user.clientId.length > 0) {
    return user.clientId;
  }

  if (!user.contact_id) {
    return null;
  }

  const connection = db ?? (await createTenantKnex(tenant)).knex;
  return getContactClientId(connection, tenant, user.contact_id);
}

export async function hasClientPortalOwnClientPermission(
  user: UserWithClientContext,
  tenant: string,
  clientId: string,
  resource: PermissionResource,
  action: string,
  db?: DbConnection
): Promise<boolean> {
  if (!isClientPortalUser(user)) {
    return false;
  }

  const [canUseResource, userClientId] = await Promise.all([
    hasPermissionAsync(user, resource, action, db),
    getClientPortalUserClientId(user, tenant, db)
  ]);

  return canUseResource && userClientId === clientId;
}

export async function hasClientPortalOwnContactPermission(
  user: UserWithClientContext,
  tenant: string,
  contactId: string,
  resource: PermissionResource,
  action: string,
  db: DbConnection
): Promise<boolean> {
  if (!isClientPortalUser(user)) {
    return false;
  }

  const [canUseResource, userClientId, contactClientId] = await Promise.all([
    hasPermissionAsync(user, resource, action, db),
    getClientPortalUserClientId(user, tenant, db),
    getContactClientId(db, tenant, contactId)
  ]);

  return canUseResource && !!userClientId && userClientId === contactClientId;
}

export async function hasMspOrClientPortalOwnClientPermission(
  user: UserWithClientContext,
  tenant: string,
  clientId: string,
  resource: PermissionResource,
  action: string,
  db?: DbConnection
): Promise<boolean> {
  if (isMspUser(user)) {
    return hasPermissionAsync(user, resource, action, db);
  }

  return hasClientPortalOwnClientPermission(user, tenant, clientId, resource, action, db);
}

export async function assertMspOrClientPortalOwnClientPermission(
  user: UserWithClientContext,
  tenant: string,
  clientId: string,
  resource: PermissionResource,
  action: string,
  message: string,
  db?: DbConnection
): Promise<void> {
  if (!await hasMspOrClientPortalOwnClientPermission(user, tenant, clientId, resource, action, db)) {
    throw new Error(message);
  }
}

export async function assertMspOrClientPortalOwnContactPermission(
  user: UserWithClientContext,
  tenant: string,
  contactId: string,
  resource: PermissionResource,
  action: string,
  message: string,
  db: DbConnection
): Promise<void> {
  const allowed = isMspUser(user)
    ? await hasPermissionAsync(user, resource, action, db)
    : await hasClientPortalOwnContactPermission(user, tenant, contactId, resource, action, db);

  if (!allowed) {
    throw new Error(message);
  }
}

export async function getSessionAsync() {
  const module = await import('@alga-psa/auth');
  return module.getSession();
}

export async function assignRoleToUserAsync(userId: string, roleId: string) {
  const module = await import('@alga-psa/auth/actions');
  return module.assignRoleToUser(userId, roleId);
}

export async function removeRoleFromUserAsync(userId: string, roleId: string) {
  const module = await import('@alga-psa/auth/actions');
  return module.removeRoleFromUser(userId, roleId);
}

export async function getRolesAsync() {
  const module = await import('@alga-psa/auth/actions');
  return module.getRoles() as Promise<IRole[]>;
}
