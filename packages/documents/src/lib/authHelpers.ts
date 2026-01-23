/**
 * Auth helpers for documents package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * documents -> auth -> ui -> analytics -> tenancy -> ... -> documents
 */

export async function getCurrentUserAsync() {
  const { getCurrentUser } = await import('@alga-psa/auth/getCurrentUser');
  return getCurrentUser();
}

export async function hasPermissionAsync(user: any, resource: string, action: string): Promise<boolean> {
  const { hasPermission } = await import('@alga-psa/auth');
  return hasPermission(user, resource, action);
}
