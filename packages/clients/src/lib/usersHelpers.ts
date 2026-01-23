/**
 * Users helpers for clients package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * clients -> users -> auth -> ui -> analytics -> tenancy -> client-portal -> clients
 */

export async function getCurrentUserAsync() {
  const module = await import('@alga-psa/users/actions');
  return module.getCurrentUser();
}

export async function getAllUsersBasicAsync(includeInactive?: boolean, userType?: string) {
  const module = await import('@alga-psa/users/actions');
  return module.getAllUsersBasic(includeInactive, userType);
}

export async function findUserByIdAsync(id: string) {
  const module = await import('@alga-psa/users/actions');
  return module.findUserById(id);
}

export async function getContactAvatarUrlActionAsync(contactId: string, tenant: string) {
  const module = await import('@alga-psa/users/actions');
  return module.getContactAvatarUrlAction(contactId, tenant);
}
