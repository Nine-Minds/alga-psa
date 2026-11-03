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

Evidence directory: `/tmp/alga-smoke-evidence/getcurrentuser-takeover`. Build, typecheck, security-test, auth-test, and startup logs are stored there. Disposable MSP and client users were prepared with password and TOTP authentication to exercise both public-user paths without changing existing accounts. Fixture secrets and cookies are private local files and must not be committed or attached as review evidence.

Full server typechecking and Next.js startup were still in progress when this note was first written. Live authentication and response checks are not claimed by the completed checks above; their final results must be recorded before calling the product smoke complete.
