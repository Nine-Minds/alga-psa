/**
 * Opt-in, allow-by-default mock of '@alga-psa/auth/rbac'.
 *
 * Why opt-in: a global rbac mock lets any new permission-denial suite pass
 * silently (the check always grants). Only suites that need it use it — the
 * email-provider fixture suites, whose guards import '@alga-psa/auth/rbac'
 * but whose fixtures don't seed role_permissions.
 *
 * vi.mock is only hoisted in the test file (or a setup file), so call it there:
 *
 *   vi.mock('@alga-psa/auth/rbac', async (orig) =>
 *     (await import('<relative>/test/helpers/allowAllRbac')).allowAllRbac(orig));
 *
 * hasPermission is the same vi.fn that setup.ts uses for the '@alga-psa/auth'
 * facade (published on globalThis), so a per-test override such as
 * `hasPermission.mockResolvedValueOnce(false)` applies through both specifiers.
 */
export const sharedHasPermission = (): ((...args: any[]) => Promise<boolean>) & Record<string, any> =>
  (globalThis as any).__algaSharedHasPermission;

export async function allowAllRbac(importOriginal: () => Promise<any>) {
  return {
    ...(await importOriginal()),
    hasPermission: sharedHasPermission(),
  };
}
