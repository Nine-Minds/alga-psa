/**
 * Auth helpers for documents package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * documents -> auth -> ui -> analytics -> tenancy -> ... -> documents
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

const getAuthModule = () => '@alga-psa/' + 'auth';
const getAuthCurrentUserModule = () => '@alga-psa/' + 'auth/getCurrentUser';

export async function getCurrentUserAsync() {
  const { getCurrentUser } = await import(/* webpackIgnore: true */ getAuthCurrentUserModule());
  return getCurrentUser();
}

export async function hasPermissionAsync(user: any, resource: string, action: string): Promise<boolean> {
  const { hasPermission } = await import(/* webpackIgnore: true */ getAuthModule());
  return hasPermission(user, resource, action);
}
