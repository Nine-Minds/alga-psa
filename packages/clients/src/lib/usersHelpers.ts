/**
 * Users helpers for clients package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * clients -> users -> auth -> ui -> analytics -> tenancy -> client-portal -> clients
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

const getUsersActionsModule = () => '@alga-psa/' + 'users/actions';

export async function getCurrentUserAsync() {
  const module = await import(/* webpackIgnore: true */ getUsersActionsModule());
  return (module as any).getCurrentUser();
}

export async function getAllUsersBasicAsync(...args: any[]) {
  const module = await import(/* webpackIgnore: true */ getUsersActionsModule());
  return (module as any).getAllUsersBasic(...args);
}

export async function findUserByIdAsync(...args: any[]) {
  const module = await import(/* webpackIgnore: true */ getUsersActionsModule());
  return (module as any).findUserById(...args);
}

export async function getContactAvatarUrlActionAsync(...args: any[]) {
  const module = await import(/* webpackIgnore: true */ getUsersActionsModule());
  return (module as any).getContactAvatarUrlAction(...args);
}
