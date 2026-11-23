import { checkCurrentUserPermissions } from '@alga-psa/auth/actions';

/**
 * Which of `keys` (`resource:action`) the signed-in user holds, decided by the same `hasPermission`
 * engine the server actions and API enforce. UI gates (menu items, Quick Create options, page buttons)
 * resolve through this so that what a user is shown matches what the server will accept.
 *
 * Deliberately not `getCurrentUserPermissions()`: that lists raw role grants through
 * `getUserRolesWithPermissions`, which requires `user:read` and therefore returns `[]` for roles such as
 * the default Technician, hiding entries the server would allow.
 */
// LEVERAGE: friction current-user-permissions-self-read — getCurrentUserPermissions requires user:read to read the caller's own grants; UI gates route around it here.
export async function resolveCurrentUserGrants(keys: readonly string[]): Promise<string[]> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const checks = unique.map((key) => {
    const separator = key.indexOf(':');
    return { resource: key.slice(0, separator), action: key.slice(separator + 1) };
  });
  try {
    const results = await checkCurrentUserPermissions(checks);
    return results.filter((result) => result.granted).map((result) => `${result.resource}:${result.action}`);
  } catch {
    return [];
  }
}
