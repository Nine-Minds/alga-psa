/**
 * Auth helpers for clients package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * clients -> auth -> ... -> clients
 */

import type { IRole } from '@alga-psa/types';

export async function hasPermissionAsync(user: any, resource: string, action: string, trx?: any): Promise<boolean> {
  const module = await import('@alga-psa/auth');
  return module.hasPermission(user, resource, action, trx);
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
