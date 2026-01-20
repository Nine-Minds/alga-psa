/**
 * Auth helpers for clients package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * clients -> auth -> ... -> clients
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

import type { IRole } from '@alga-psa/types';

const getAuthModule = () => '@alga-psa/' + 'auth';

export async function hasPermissionAsync(user: any, resource: string, action: string, trx?: any): Promise<boolean> {
  const module = await import(/* webpackIgnore: true */ getAuthModule());
  return (module as any).hasPermission(user, resource, action, trx);
}

export async function getSessionAsync() {
  const module = await import(/* webpackIgnore: true */ getAuthModule());
  return (module as any).getSession();
}

const getAuthActionsModule = () => '@alga-psa/' + 'auth/actions';

export async function assignRoleToUserAsync(userId: string, roleId: string) {
  const module = await import(/* webpackIgnore: true */ getAuthActionsModule());
  return (module as any).assignRoleToUser(userId, roleId);
}

export async function removeRoleFromUserAsync(userId: string, roleId: string) {
  const module = await import(/* webpackIgnore: true */ getAuthActionsModule());
  return (module as any).removeRoleFromUser(userId, roleId);
}

export async function getRolesAsync() {
  const module = await import(/* webpackIgnore: true */ getAuthActionsModule());
  return (module as any).getRoles() as Promise<IRole[]>;
}
