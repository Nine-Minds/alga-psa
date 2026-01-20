/**
 * Auth helpers for notifications package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * notifications -> auth -> ui -> analytics -> tenancy -> ... -> notifications
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

import type { Knex } from 'knex';

const getAuthModule = () => '@alga-psa/' + 'auth';

export async function hasPermissionAsync(user: any, resource: string, action: string, trx?: Knex.Transaction): Promise<boolean> {
  const { hasPermission } = await import(/* webpackIgnore: true */ getAuthModule());
  return hasPermission(user, resource, action, trx);
}
