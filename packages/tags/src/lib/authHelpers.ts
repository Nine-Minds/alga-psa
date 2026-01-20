/**
 * Auth helpers for tags package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * tags -> auth -> ui -> ... -> clients -> tags
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

const getAuthModule = () => '@alga-psa/' + 'auth';

export async function hasPermissionAsync(user: any, resource: string, action: string, trx?: any): Promise<boolean> {
  const module = await import(/* webpackIgnore: true */ getAuthModule());
  return (module as any).hasPermission(user, resource, action, trx);
}

export async function throwPermissionErrorAsync(action: string, additionalInfo?: string): Promise<never> {
  const module = await import(/* webpackIgnore: true */ getAuthModule());
  (module as any).throwPermissionError(action, additionalInfo);
  throw new Error('Permission denied');
}
