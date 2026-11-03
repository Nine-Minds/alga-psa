# Credential-boundary smoke build repair

The mitigation repairs the pre-existing SQL binding error that prevented the email-service dependency build and application startup. No approved branch plan exists (`git log main..HEAD --name-only -- docs/plans/` returned no paths).

`SqlFragment.bindings` now uses `Knex.RawBinding[]`. Ticket computed resolvers preserve `PredicateValue` and `PredicateLiteral` instead of widening values to `unknown`. Scalar bindings reject missing values before reaching Knex. The SQL compiler no longer needs a binding assertion. Existing SQL structure, tenant correlation, and parameterization are retained.

The ticket-query test now exercises every computed attribute/operator through Knex's raw SELECT composition used by checklist matching, including native parameter conversion. No implementation-text assertions were added.

## Completed checks

- Prescribed `build-service.sh <worktree> services/email-service`: passed, including all dependency builds.
- Normal `PORT=3156 npm run dev` dependency path: all 64 Nx tasks passed.
- Predicate typecheck: passed; predicate tests: 250 passed.
- Ticket-query schema tests: 21 passed.
- Security/action and PostgreSQL user projection tests: 18 passed.
- Auth tenant scoping, current-user, and API-key context tests: 28 passed.
- Repair commit: `89ac5cac03`. No push or PR. The pre-existing `package-lock.json` modification remains excluded.

## Environment and live verification

The requested `workflow-ensure-service` command resumed the board service, but the board suspended it within four seconds because “Draft Implementation” does not use the service. This is a workflow lifecycle issue, separate from the repaired build failure. A temporary task-owned process uses the same `PORT=3156 npm run dev` command and preserves dependency builds.

Evidence directory: `/tmp/alga-smoke-evidence/getcurrentuser-takeover`. Build, typecheck, security-test, auth-test, and startup logs are stored there. Disposable MSP and client users were prepared with password and TOTP authentication to exercise both public-user paths without changing existing accounts. Disposable fixture users, their roles/sessions, and the contact were removed after testing; the private fixture and cookie files were deleted. No existing account settings were changed.

## Final live results

The application served on port 3156 after the normal dependency build. HTTP checks used the card hostname with DNS mapped to loopback, CSRF-backed credentials callbacks, and actual session cookies. They used the existing Next.js server-action references from the generated manifest; no test route or authorization bypass was added.

- Both disposable identities rejected a missing TOTP code, an invalid code, and a wrong password. Both accepted the correct password plus current TOTP, with the expected identity returned by `/api/auth/session`.
- `getCurrentUser` returned the expected caller for both MSP and client identities and excluded both credential field names and the actual stored password hash/TOTP seed.
- MSP `findUserById`, `getUserWithRoles`, `getAllUsers`, and `getAllUsersBasic` returned the expected user without credentials. Together with `getCurrentUser`, all five checked user-query actions passed.
- Client dashboard HTML returned 200 and contained neither credential names nor the test user's credential values.
- Browser navigation reached the card's sign-in and dashboard routes, and the browser session endpoint confirmed `qa@emeraldcity.oz` as an internal user. Browser contexts repeatedly navigated or disappeared; the captured dashboard screenshot was blank. This does **not** establish a successful visual dashboard/portal walkthrough. The reproducible credential and TOTP conclusions above come from live HTTP responses, not screenshots.

### Separate ticket-data leak remains

The MSP ticket detail HTML returned 200 but contained the disposable MSP user's password hash and TOTP seed. Decoding the Flight payload identifies `ticketData.availableAgents` as the leaking property; `ticketData.userMap` is safe. `getConsolidatedTicketData` in `packages/tickets/src/actions/optimizedTicketActions.ts` loads complete user rows around line 580 and supplies this list. This is the explicitly separate card `e3c2e9fc` root cause, not a failure of the current-user action. No change to that separate implementation is included here. The whole ticket page must **not** be described as credential-free.

### Typecheck limitation

The full server typecheck exits 2 with the six previously established baseline TS2769 errors in `packages/billing/src/actions/profitabilityReportActions.ts` at lines 367, 690, 845, 926, 1013, and 1087. They bind a readonly invoice-status tuple to Knex. The former seventh error in `applyTemplates.ts` is resolved, and no new errors remain. The parent comparison is recorded in `current-user-typecheck-comparison.json`. No checks or dependency builds were disabled.

### Evidence and review order

Committed, sanitized machine-readable evidence: [authentication results](current-user-live-authentication.json), [scoped response results](current-user-live-boundary.json), and [ticket user paths and field names](current-user-ticket-user-paths.json). The latter contains keys and paths only, never credential values.

Review the binding contract and producer types first, then the scoped response evidence and the separate ticket-page failure. Local logs and the smoke scripts remain in `/tmp/alga-smoke-evidence/getcurrentuser-takeover`; `cleanup-results.json` confirms fixture removal. The temporary verification server is stopped after testing because this workflow step suspends its board-owned equivalent. The normal service can be ensured again in a service-enabled step. No background verification is pending.
