/**
 * Auth helpers for tags package
 *
 * TODO: Consolidate with @alga-psa/auth after circular dependency is resolved
 */

import { hasPermission, throwPermissionError } from './permissions';

export async function hasPermissionAsync(user: any, resource: string, action: string, trx?: any): Promise<boolean> {
  return hasPermission(user, resource, action, trx);
}

export async function throwPermissionErrorAsync(action: string, additionalInfo?: string): Promise<never> {
  return throwPermissionError(action, additionalInfo);
}
