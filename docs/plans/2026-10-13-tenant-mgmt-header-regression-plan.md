# Operator-route auth regression tests: plan

Date: 2026-10-13
Branch: `feature/regression-tests-tenant-management-routes-reject`
PSA: alga-2026-0002636

## Goal

PR #3478 moved every platform-operator API route onto one gate,
`assertMasterTenantAccess` (`ee/server/src/lib/auth/masterTenantAccess.ts:39`).
The only test it shipped is a unit test of the gate itself
(`ee/server/src/__tests__/unit/applianceConsole/auth.test.ts`). Nothing checks
that each **route** still calls the gate before doing work, or that a route
returns 401/403 instead of 200/500 when the gate rejects. A route that brings
back a private header-trust branch, or skips the gate on one method, would
still pass CI today.

This plan adds route-level tests that fail if that happens:

1. Every handler on every operator route gets spoofed `x-internal-*` headers
   with no valid master-tenant credential. It must return 401/403 and must not
   reach any downstream service.
2. The same handlers reject the session shapes that the old private gates let
   through (a member of the master tenant without the permission, a client
   user, a session from another tenant, a bad API key with a valid session
   behind it).
3. A static inventory test fails when an operator route is added, or loses its
   gate, without the behavioural matrix being updated.

All suites run with `MASTER_BILLING_TENANT_ID` set, which is the hosted
configuration where these routes matter.

## What the code looks like today (base `a65fccb78c`, fix already in base)

The gate (`masterTenantAccess.ts`):

- `:40-43` throws `MASTER_BILLING_TENANT_ID not configured` when the env var is unset.
- `:45-61`: when an `x-api-key` header is present, it must validate (`:48`)
  and belong to the master tenant (`:51`). An invalid key never falls back to
  the session.
- `:63-73`: session path. Needs `getCurrentUser()`, `tenant === master`,
  `user_type === 'internal'`, and `hasPermission(user, 'system_settings', 'update')`.
- No `x-internal-*` header is read anywhere in the repo outside tests.
  `grep -rn x-internal` only matches the unrelated
  `server/src/app/api/internal/check-tenant-email/route.ts:15` (`x-internal-secret`).

The thirteen tenant-management routes. Each calls the gate first and maps errors through
`tenantManagementRouteError` (`tenant-management/tenantManagementRouteErrors.ts:16-30`:
`Authentication required` / invalid key go to 401, `Access denied*` goes to 403):

| Route (`ee/server/src/app/api/v1/tenant-management/…`) | Method | Gate line |
|---|---|---|
| `addons/route.ts` | GET | 17 |
| `audit/route.ts` | GET | 10 |
| `confirm-deletion/route.ts` | POST | 27 |
| `create-tenant/route.ts` | POST | 53 |
| `export-status/route.ts` | GET | 20 |
| `export-tenant/route.ts` | POST | 29 |
| `exports/route.ts` | GET | 23 |
| `pending-deletions/route.ts` | GET | 26 |
| `resend-welcome-email/route.ts` | POST | 19 |
| `rollback-deletion/route.ts` | POST | 26 |
| `start-deletion/route.ts` | POST | 25 |
| `tenants/route.ts` | GET | 13 |
| `tenants/[tenantId]/addons/route.ts` | POST | 30 |

`exports/[exportId]/download-url/route.ts` is a fourteenth file. It returns a
constant 410 and touches no data (`:14-22`), so it is listed in the inventory
as an explicit ungated exception and is not in the matrix.

The other operator surfaces, which had their own membership-only copies of the gate
before #3478, are listed below. Most map gate errors with `includes('Access denied') || includes('Authentication')`
to 403. The appliance routes use `isMasterTenantAuthError` and also return 403.
Provisioning returns 401 for unauthenticated callers and 403 for everything else.

| Route (`ee/server/src/app/api/…`) | Methods | Gate line(s) |
|---|---|---|
| `provisioning/tenants/route.ts` | POST | 10 |
| `v1/appliance-installs/route.ts` | GET, POST (POST via `handleApplianceTrigger`, `lib/applianceConsole/triggerRoute.ts:56`) | 25 |
| `v1/appliance-installs/access/route.ts` | POST | 20 |
| `v1/appliance-installs/[tenantId]/route.ts` | GET, POST (trigger) | 29 |
| `v1/appliance-installs/[tenantId]/audit/route.ts` | GET | 23 |
| `v1/appliance-installs/[tenantId]/billing/route.ts` | GET | 27 |
| `v1/appliance-installs/workflows/[workflowId]/route.ts` | GET | 30 |
| `v1/platform-feature-flags/route.ts` | GET, POST | 47, 80 |
| `v1/platform-feature-flags/[flagId]/route.ts` | GET, POST(`__method` PATCH/DELETE), PATCH | 52, 103, 127 |
| `v1/platform-feature-flags/[flagId]/tenants/route.ts` | POST | 30 |
| `v1/platform-notifications/route.ts` | GET, POST | 26, 76 |
| `v1/platform-notifications/[notificationId]/route.ts` | GET, PUT, POST(`__method`), DELETE | 34, 92, 204 |
| `v1/platform-notifications/[notificationId]/reads/route.ts` | GET | 31 |
| `v1/platform-notifications/[notificationId]/stats/route.ts` | GET | 32 |
| `v1/platform-notifications/resolve-recipients/route.ts` | POST | 25 |
| `v1/platform-reports/route.ts` | GET, POST | 30, 81 |
| `v1/platform-reports/[reportId]/route.ts` | GET, PUT, POST(`__method`), DELETE | 38, 96, 216 |
| `v1/platform-reports/[reportId]/execute/route.ts` | POST | 36 |
| `v1/platform-reports/access/route.ts` | POST | 35 |
| `v1/platform-reports/audit/route.ts` | GET | 28 |
| `v1/platform-reports/schema/route.ts` | GET | 33 |

That is 34 route files and about 46 handler/method entries (counting each `__method`
override as its own entry). The CE files under `server/src/app/api/v1/…` only
lazy-import the EE route and contain no auth logic, so they are out of scope (see below).

Reading the code turned up no route that still accepts the spoofed headers. The tests
are there to prove that and to keep it true. If a test does find a route that
accepts them, the fix goes in this PR (step 5).

## Design decisions

**D1. Do not mock the gate; mock the identity sources.** The new suites mock only
`@alga-psa/user-composition/actions#getCurrentUser`, `@alga-psa/auth#hasPermission`,
and `@/lib/services/apiKeyServiceForApi#ApiKeyServiceForApi.validateApiKeyAnyTenant`.
This is the same seam `auth.test.ts:3-21` uses. The real `assertMasterTenantAccess`
runs inside each real route handler, along with the real `tenantManagementRouteError`
and the real `handleApplianceTrigger`. `applianceConsole/triggerRoute.test.ts:12`
mocks the gate itself and so cannot catch a route that bypasses it. That pattern is
not used here.

**D2. Tripwire every downstream module.** Each module a route reaches after the gate is
replaced with a factory whose functions are `vi.fn()` spies sharing one
`downstream` call log. The modules are: `@alga-psa/db`, `@alga-psa/db/admin`,
`@ee/lib/tenant-management/workflowClient`, `@ee/lib/platformReports` (+ `/blocklist`),
`@ee/lib/platformNotifications`, `@ee/lib/platformFeatureFlags`,
`@ee/lib/applianceConsole/{algaLicenseAdminClient,workflowClient,stripeBilling}`,
`@ee/lib/storage/s3-client`, `services/provisioning`, and `@/lib/observability/logging`
(spied but allowed, because routes log on rejection too). The import list was taken by
grepping the `from` clauses of all 34 route files. A rejection case asserts both:

- `response.status` is in `{401, 403}` (the exact code is pinned per surface: tenant-management
  and provisioning return 401 for anonymous callers and 403 otherwise; the other surfaces return 403), and
- no tripwire was called (logging excepted).

Without the second check, a route that did the work and then returned an error
status would still pass.

**D3. Every case includes the spoofed headers.** The base header set is
`x-internal-request: ext-proxy-prefetch`, `x-internal-user-id: attacker`,
`x-internal-user-tenant: <MASTER>`, `x-internal-user-email: attacker@example.test`.
These are the headers the removed `getInternalUserInfo` trusted (see
`git show a01c71f22e^:ee/server/src/app/api/v1/tenant-management/start-deletion/route.ts`).
Each case in the matrix adds a credential state on top of them:

| Case | Credential state | Expected |
|---|---|---|
| C1 | none (`getCurrentUser → null`) | 401 (TM/provisioning) / 403 |
| C2 | session, internal user of **another** tenant | 403 |
| C3 | session, internal user of master tenant, `hasPermission → false` (the membership-only case) | 403 |
| C4 | session, **client** user of master tenant | 403 |
| C5 | `x-api-key: junk` (invalid) **plus** a valid permitted master session behind it | 401/403, and `getCurrentUser` not called |
| C6 | valid API key of a non-master tenant | 403 |
| P  | positive control: permitted internal master user, spoof headers still present | status ∉ {401,403} **and** at least one tripwire was called |

The positive control is what makes the negative cases mean something. It shows the
test actually reached the handler, so a rejection is not just a failed import or a
missing param. In P the tripwires return minimal stubs or throw a sentinel. The test
only checks that control got past the gate, not what the business logic returned.

**D4. Table-driven, one entry per handler.** A single route table drives the matrix:
`{ name, load: () => import(route), method, makeRequest, context?, body? }`.
`context` supplies `params: Promise.resolve({...})` for dynamic segments. POST
overrides send `{ __method: 'PUT' | 'DELETE' | 'PATCH' }`. Bodies are minimal but
valid JSON, so a handler cannot answer 400 before reaching the gate (all current
handlers call the gate before parsing, but the test should not rely on that).
`describe.each(routes)` × `it.each(cases)`.

**D5. Requests are real `NextRequest`s** from the `next/server` stub
(`server/src/test/stubs/next-server.ts`, aliased in `ee/server/vitest.config.ts`).
They carry a real `Headers`, a URL (some handlers read `searchParams`), and a JSON body.
The `{ headers } as never` shortcut used in `auth.test.ts:23` is not enough for route
handlers.

**D6. Env is set before import.** `tenants/route.ts:9` and `audit/route.ts:6` (and
others) read `process.env.MASTER_BILLING_TENANT_ID` when the module loads. In
`beforeEach`: `vi.resetModules()`, then `vi.stubEnv('MASTER_BILLING_TENANT_ID', MASTER)`,
and only then the dynamic `import()` of the route. `afterEach`: `vi.unstubAllEnvs()`.
The npm command also exports the variable so nothing reads it as unset.

**D7. Static inventory guard.** `operatorRoutes.inventory.test.ts` globs
`ee/server/src/app/api/{v1/tenant-management,v1/platform-*,v1/appliance-installs,provisioning}/**/route.ts`
and asserts:
- no file contains the string `x-internal-`;
- every file except the allow-listed `exports/[exportId]/download-url/route.ts`
  references `assertMasterTenantAccess` or `handleApplianceTrigger`;
- the set of `(file, exported method)` pairs, ignoring `OPTIONS`, equals the set
  covered by the behavioural route table. Adding a route or method without a matrix
  row fails CI and names the missing route.

This guard gives lasting coverage of new routes. The behavioural matrix gives coverage
of the current ones.

## Changes

New files (EE unit tests, next to the existing gate test):

1. `ee/server/src/__tests__/unit/operatorRoutes/operatorRouteHarness.ts`:
   shared `vi.hoisted` identity mocks, the tripwire registry, the `SPOOFED_HEADERS` constant,
   `makeRequest(method, url, headers, body)`, credential-case setup functions (C1–C6, P),
   and the route-table type. Note that `vi.mock` calls must stay in each test file
   because they are hoisted per file. The harness exports factories, and each spec
   calls `vi.mock('<mod>', harness.tripwireFactory('<mod>'))`.
2. `ee/server/src/__tests__/unit/operatorRoutes/tenantManagementRoutes.spoofedHeaders.test.ts`:
   the 13 tenant-management routes × C1–C6 + P.
3. `ee/server/src/__tests__/unit/operatorRoutes/platformOperatorRoutes.spoofedHeaders.test.ts`:
   platform-reports, platform-notifications, and platform-feature-flags × C1–C6 + P.
4. `ee/server/src/__tests__/unit/operatorRoutes/applianceAndProvisioningRoutes.spoofedHeaders.test.ts`:
   appliance-installs (including both `handleApplianceTrigger` POSTs) and
   `provisioning/tenants` × C1–C6 + P.
5. `ee/server/src/__tests__/unit/operatorRoutes/operatorRoutes.inventory.test.ts`: D7.
   It imports the three route tables, or a shared `routeTable.ts` that the spec
   files also import, so there is one source of truth.

The surfaces are split across three spec files so a failure points at a surface and
each file's `vi.mock` set stays small.

Modified:

6. `ee/server/package.json` gets the script
   `"test:operator-auth": "MASTER_BILLING_TENANT_ID=00000000-0000-4000-8000-0000000000aa vitest run src/__tests__/unit/operatorRoutes src/__tests__/unit/applianceConsole/auth.test.ts"`.
   CI's existing `test:unit` already picks up the directory. The tests also stub the env
   themselves (D6), so they pass under plain `test:unit` as well.

Not modified unless a test goes red: every route file listed above.

## Order of work

1. Write the harness and `routeTable.ts`. Get **one** route (`tenant-management/start-deletion`)
   green through all seven cases, so the mocking seam and the D6 env timing are proven.
2. Prove the test catches the bug (local only, never committed): paste the pre-fix
   `getInternalUserInfo` branch back into `start-deletion/route.ts` and confirm C1 fails
   with a 2xx/tripwire hit. Then do the same with a membership-only session check
   (drop `hasPermission`) and confirm C3 fails. Revert both. Record the output in the PR body
   (worded neutrally).
3. Fill in the remaining 12 tenant-management rows, then the platform-* rows, then appliance/provisioning.
4. Add the inventory guard. Confirm it fails when a dummy `route.ts` is dropped under
   `v1/platform-reports/`, then delete the dummy.
5. If any route fails a rejection case, fix it in that route (route it through
   `assertMasterTenantAccess` and map errors through the surface's existing mapper) in
   a separate commit, with the test commit landing first so the history shows red → green.
6. Run `cd ee/server && npm run test:operator-auth` and the full `npm run test:unit`. Also
   run `npx tsc --noEmit -p ee/server` on the new files.
7. Commit with a neutral message ("Add route-level auth regression tests for operator APIs").

## Out of scope

- Advisory text, patched-version numbering, CVE request, disclosure date, publication.
  Commit messages, the PR body, and this doc say "auth regression test coverage" only.
- CE stub routes under `server/src/app/api/v1/{tenant-management,platform-*,appliance-installs}`.
  They hold no auth logic and only lazy-import the EE route. A request to a CE stub runs
  the same EE handler under test.
- Integration/E2E tests against a running server or DB. The bug is a pure decision about
  request identity, the seam in D1 covers it fully, and a DB-backed version would need
  hosted-only master-tenant fixtures without adding coverage.
- The `x-api-key` runner identity forwarding (`x-user-id` / `x-user-email` are trusted
  for audit labelling once a valid master key is present, `masterTenantAccess.ts:58-59`).
  That is the intended trust model for uiProxy, and `auth.test.ts:102-120` already covers it.
- `platformNotifications/actions.ts` (end-user server actions scoped to `user.tenant`, not
  an operator surface).
- Edge-middleware stripping of inbound `x-internal-*` headers. It would be possible
  defence in depth, but nothing reads those headers now, and D7 enforces that.
- Refactoring the five copies of the `includes('Access denied') || includes('Authentication')` → 403
  mapper. Recorded as a `LEVERAGE: pattern` hypothesis only; not touched.

## Risks and how they're handled

- **Mocks too loose, so the tests pass vacuously.** If a tripwire factory misses an export,
  the import throws and the route returns 500. A 500 fails the `{401,403}` assertion, and
  case P catches anything that never reaches the handler. Step 2's red-proof confirms the
  tests detect the bug.
- **Module-load env reads (D6).** If `vi.resetModules()` or the env stub ordering is wrong,
  `MASTER_BILLING_TENANT_ID` is `undefined` in the route and the gate throws `not configured`,
  which returns 500. Case P fails loudly, so this cannot be silently green.
- **Strict status pinning is brittle.** Pinning 401 vs 403 per surface documents the current
  contract. If someone deliberately changes a mapper, they update one constant per surface,
  which is acceptable.
- **The `__method` override POSTs parse the body before the gate.**
  `platform-notifications/[notificationId]/route.ts:164-185` and the equivalent reports/flags
  routes return 405 or 400 on a bad body before auth. That is not a leak, because no work is
  done. The matrix always sends a valid `__method` so the gated path is the one exercised.
- **Shuffle / single-fork config** (`vitest.config.ts:10-22`). Tests must not share state
  across files. Each file owns its mocks, and `beforeEach` resets modules and mocks.
- **globalSetup requires `DATABASE_URL`** (`vitest.globalSetup.js:13`). It is provided by
  `ee/server/.env.test`. No DB connection is opened because `@alga-psa/db*` are tripwired.
- **Public repo.** `masterTenantAccess.ts:15` and `auth.test.ts:60` already name the advisory ID
  in source. Those lines are not added to or edited here. Whether to scrub them before publication
  is for the captain to decide.
