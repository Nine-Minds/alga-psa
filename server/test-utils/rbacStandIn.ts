/**
 * Suites that stand in for coarse RBAC replace `hasPermission`. Production code also asks several
 * permissions at once through `checkMultiplePermissions` (one roles load for a hot path), so a
 * stand-in that only replaces `hasPermission` silently falls through to the real roles query for
 * those callers. This derives the batched form from the suite's own `hasPermission`, so both
 * answer every check the same way.
 *
 * Use it inside a `vi.mock` factory (dynamic import, since factories are hoisted):
 *
 *   vi.mock('@alga-psa/auth/rbac', async () => {
 *     const { rbacStandIn } = await import('../../test-utils/rbacStandIn');
 *     return rbacStandIn(async () => true);
 *   });
 */
type HasPermission = (user: any, resource: string, action: string, connection?: unknown) => unknown;

export function checkMultiplePermissionsFrom(hasPermission: HasPermission) {
  return async (user: any, checks: ReadonlyArray<{ resource: string; action: string }>, connection?: unknown) =>
    Promise.all(checks.map(async ({ resource, action }) => ({
      resource,
      action,
      granted: Boolean(await hasPermission(user, resource, action, connection)),
    })));
}

export function rbacStandIn(hasPermission: HasPermission) {
  return { hasPermission, checkMultiplePermissions: checkMultiplePermissionsFrom(hasPermission) };
}
