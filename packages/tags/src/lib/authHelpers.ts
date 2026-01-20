/**
 * Auth helpers for tags package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * tags -> auth -> ui -> ... -> clients -> tags
 */

export async function hasPermissionAsync(user: any, resource: string, action: string, trx?: any): Promise<boolean> {
  const module = await import('@alga-psa/auth');
  return module.hasPermission(user, resource, action, trx);
}

export async function throwPermissionErrorAsync(action: string, additionalInfo?: string): Promise<never> {
  const module = await import('@alga-psa/auth');
  return module.throwPermissionError(action, additionalInfo);
}
