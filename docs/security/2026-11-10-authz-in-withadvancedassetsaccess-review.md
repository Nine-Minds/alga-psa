# Security review guide: NinjaOne principal authorization

## Finding and evidence

The approved plan, [2026-11-10-authz-in-withadvancedassetsaccess-fix-plan.md](../plans/2026-11-10-authz-in-withadvancedassetsaccess-fix-plan.md), confirmed that the shared NinjaOne boundary authenticated callers and checked the Advanced Assets tier without limiting principal type.

- Before this change, `withAdvancedAssetsAccess` called `assertTierAccess` immediately after `withAuth` in `ee/server/src/lib/actions/integrations/ninjaoneActions.ts:86-93`.
- `withAuth` resolves the authenticated user and passes its type through without an MSP-only check in `packages/auth/src/lib/withAuth.ts:151-178`.
- PSA `settings:read` and `settings:update` are client-capable and granted to client Admin (read also to client Finance) in `server/migrations/utils/permissions/catalog.cjs:272,275`. `hasPermission` selects client grants for client principals in `packages/authorization/src/rbac.ts:84-98`.
- The exposed paths were `saveNinjaOneCredentials` (`ninjaoneActions.ts:236-260`), `getNinjaOneConnectUrl` (`:797-828`, including persisted OAuth state at `:827`), and `getNinjaOneOrganizationMappings` (`:657-691`). All 22 exported NinjaOne actions use `withAdvancedAssetsAccess`.
- The callback consumes the persisted state at `ee/server/src/app/api/integrations/ninjaone/callback/route.ts:208-216`, then writes OAuth credentials and creates or updates the tenant integration row at `:270-354`.

## Change and behavior

`withAdvancedAssetsAccess` now checks `isMspPrincipalUserType(user.user_type)` immediately after authentication. It rejects client, missing, null, and unknown types with `NinjaOne integration actions are restricted to MSP users.` before tier evaluation or handler work. Authentication, the existing Advanced Assets tier check, and each action's existing permission check remain in place and in order after this guard.

The `internal` and `service` principal types remain eligible, subject to the existing tier and action permissions. Rejected principals receive a rejected action promise because the guard throws at the shared wrapper boundary, outside action-level `try/catch` blocks.

The regression suite exercises the exported actions through the real wrapper. Mocks allow the client path to complete and produce state/credential writes and organization-mapping reads if the guard is absent. Before the guard, the client-path test returned successful results for all three actions; the null and unknown cases also resolved. That baseline run reported **4 failed, 4 passed** tests. With the guard, the suite reported **8 passed, 0 failed**. It also proves authorized `internal` and `service` behavior and verifies tier and permission checks remain required.

## Verification

- `DATABASE_URL='postgresql://test:test@127.0.0.1:5432/test' npm -w ee/server exec vitest -- run src/__tests__/unit/integrations/ninjaoneAdvancedAssetsAccess.authz.test.ts --reporter=verbose` — **passed, 8/8** after the guard. The baseline run of the same command, with the guard temporarily removed, failed as described above.
- `DATABASE_URL='postgresql://test:test@127.0.0.1:5432/test' npm -w ee/server exec vitest -- run src/__tests__/unit/ninjaoneProactiveRefresh.schedule.test.ts src/__tests__/unit/ninjaoneProactiveRefresh.execution.test.ts src/__tests__/unit/ninjaOneDeviceSyncStrategy.test.ts src/__tests__/unit/ninjaOneClient.baseUrl.test.ts src/__tests__/unit/ninjaOneClient.proactiveSchedule.test.ts src/__tests__/unit/ninjaOneClient.orgDevicePagination.test.ts src/__tests__/unit/integrations/ninjaoneAlertNormalizer.test.ts src/__tests__/unit/integrations/ninjaoneActionsTenantScoped.contract.test.ts src/__tests__/unit/integrations/ninjaOneRemoteControl.test.ts --reporter=dot` — **passed, 9 files / 43 tests**.
- `NODE_OPTIONS='--max-old-space-size=12288' npm -w ee/server run typecheck` — **passed**. The default-heap and 8 GB attempts exited 134 with Node heap out-of-memory errors and no TypeScript diagnostics.
- `NODE_OPTIONS='--max-old-space-size=12288' npm run build:ee` — **passed**. The repository command built the enterprise edition and generated all 74 static pages. A first attempt at the default 8 GB heap failed when a Next.js build worker ran out of memory. The successful retry reported existing warnings for a conflicting scheduling export and dynamic dependency expressions.

## Follow-up

Permission-catalog tightening remains follow-up work: `settings:read/update` stay client-capable for their portal use cases. This change does not modify the catalog, generic `withAuth`, OAuth callback, or other integrations.

## Review first

Inspect the guard ordering in `ee/server/src/lib/actions/integrations/ninjaoneActions.ts:86-96`, then the behavioral cases in `ee/server/src/__tests__/unit/integrations/ninjaoneAdvancedAssetsAccess.authz.test.ts`. In particular, confirm that `service` eligibility is intended for this integration and that the rejected-promise behavior is suitable for callers.
