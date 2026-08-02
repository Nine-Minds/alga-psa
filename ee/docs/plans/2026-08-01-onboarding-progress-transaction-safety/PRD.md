# PRD — Transaction-Safe Onboarding Progress Persistence

- Slug: `2026-08-01-onboarding-progress-transaction-safety`
- Date: 2026-08-01
- Status: Ready for implementation

## Summary

Make onboarding progress persistence transaction-aware and concurrency-safe so an administrator can complete onboarding with a valid support email without a PostgreSQL `55P03` lock timeout. Onboarding actions that already own a database transaction will persist their progress through that same transaction. Independent progress writes will apply atomic JSONB patches, and the wizard will serialize step-position saves and drain them before final completion.

The correction applies to the shared onboarding code used by all installation types. A new appliance installation exposes the defect predictably because the application database role has an 8-second `lock_timeout`; that guardrail remains unchanged.

## Problem

`configureTicketing` opens a transaction and, when a valid support email is supplied, updates the tenant's `tenant_settings` row. Before committing, it invokes the authenticated `saveTenantOnboardingProgress` action. That action opens other database connections and attempts to update the same row. The outer transaction still owns the row lock, so the nested update waits for its caller and PostgreSQL cancels it when `lock_timeout` expires.

The failed progress write causes the entire ticketing transaction to roll back, preventing onboarding completion. Retrying can succeed only after the failed transaction clears, and omitting the support email avoids the particular row-lock sequence, but neither is an acceptable product behavior.

The shared progress writer has a second defect: it reads existing onboarding JSON, merges in application memory, then writes the full document using separate queries/connections. Concurrent saves can read the same original value and overwrite one another. The wizard increases this risk by starting a fire-and-forget step-position save whenever the step changes.

Existing DB-backed ticketing coverage does not catch the failure because it mocks `saveTenantOnboardingProgress` and therefore never exercises the competing write.

## Goals

- Allow onboarding to complete with a valid support email under the configured application-role lock timeout.
- Ensure an onboarding action never opens a second connection to persist progress while its current transaction may hold related locks.
- Provide one reusable, tenant-scoped progress persistence primitive that accepts an existing Knex connection or transaction.
- Preserve the current shallow-patch semantics of `Partial<WizardData>` while making the patch atomic at the database level.
- Prevent concurrent progress patches from losing unrelated top-level onboarding fields.
- Serialize wizard step-position saves and settle pending saves before final ticketing/completion writes.
- Apply the transaction-aware pattern consistently to every current onboarding action that saves progress from inside a transaction.
- Add DB-backed regression coverage that exercises the real persistence implementation and relevant lock timeout.
- Validate the corrected flow on a newly installed appliance.

## Non-goals

- Increasing, disabling, or otherwise changing `lock_timeout` or `idle_in_transaction_session_timeout`.
- Retrying `55P03` as the primary correction.
- Changing onboarding steps, fields, validation, navigation rules, or visible copy.
- Changing the meaning or storage shape of existing `WizardData` fields.
- Deep-merging nested objects inside `onboarding_data`; the existing top-level shallow-merge contract remains authoritative.
- Redesigning all tenant settings writers outside onboarding.
- Adding a schema migration, data backfill, feature flag, metrics, or alerting.
- Making failure to persist a step position block ordinary wizard navigation.

## Users and Primary Flows

### New tenant administrator completing onboarding

1. The administrator configures ticketing and enters a valid support email.
2. `configureTicketing` creates or updates ticketing records and writes the support email inside one transaction.
3. Ticketing progress is patched through the same transaction and connection.
4. The transaction commits without waiting on itself.
5. Pending step-position persistence is settled before onboarding is marked complete.
6. Onboarding completes, with the support email and ticketing configuration retained.

### Administrator navigating between onboarding steps

1. Each step change queues a position save after the preceding position save.
2. Navigation remains responsive; a failed position-only save is logged but does not block the administrator.
3. Atomic server-side patches preserve progress fields written by step actions while updating `currentStep`.
4. A refresh resumes from the last successfully persisted position.

### Existing onboarding action persisting progress

1. An action that owns a transaction calls the internal persistence primitive with its `trx` and authenticated tenant ID.
2. An action without a transaction continues to use the authenticated public progress action.
3. Both paths use the same atomic patch behavior and tenant scoping.

## UX / UI Notes

- No visible UI or copy changes are required.
- Step transitions remain non-blocking.
- Final completion may wait for already-queued position saves, but must not fail solely because a position-only save failed.
- Existing user-facing ticketing errors remain the fallback for genuine configuration failures.

## Requirements

### Functional Requirements

#### Transaction-aware persistence primitive

- Add a server-only tenancy persistence primitive that accepts:
  - a `Knex` connection or `Knex.Transaction` supplied by the caller;
  - the authenticated tenant ID;
  - a `Partial<WizardData>` patch.
- The primitive must use `tenantDb` for the `tenant_settings` access.
- The primitive must not call `withAuth`, `getTenantSettings`, or `createTenantKnex`; connection acquisition and authorization remain caller responsibilities.
- The primitive must execute one tenant-scoped insert/upsert statement that:
  - creates the tenant settings row when it is absent;
  - treats a null `onboarding_data` value as an empty JSON object;
  - shallow-merges the incoming JSONB patch into the stored JSONB document;
  - preserves stored top-level keys not present in the incoming patch;
  - lets incoming values replace stored values for matching top-level keys;
  - updates `updated_at`.
- Undefined properties must retain the current behavior of being omitted from the stored JSON patch rather than erasing existing values.

#### Authenticated action facade

- Keep `saveTenantOnboardingProgress` as the public authenticated action used by callers that do not already own a transaction.
- The action must acquire one tenant database connection and delegate to the primitive.
- The action must not perform a separate read before applying the patch.
- Existing call signatures and failure propagation must remain compatible unless a compile-time-safe import adjustment is required.

#### Transaction-owning onboarding actions

- Replace calls to the authenticated progress action from every current transaction callback with calls to the primitive using that callback's `trx` and tenant.
- At minimum, cover the transaction-wrapped tenant-details, team-members, billing, and ticketing flows currently saving progress from inside their transactions.
- `configureTicketing` must persist the support email and ticketing progress through the same transaction.
- If ticketing configuration fails after either write, both the support email mutation and its progress patch must roll back together.
- Transaction callbacks must not invoke the public progress action or acquire a new database connection to persist progress.
- Non-transactional onboarding callers may continue to call the public action.

#### Step-position write ordering

- Queue step-position saves so no two saves initiated by one mounted wizard execute concurrently.
- Preserve the order in which step changes occurred so a slower earlier request cannot overwrite a newer position.
- Keep position-save failures non-fatal to navigation and log them through the existing error path.
- Before final validation, ticketing configuration, and completion begin, wait for the current position-save queue to settle.
- A rejected position save must be contained so it does not poison later queued saves or prevent final completion.
- Do not allow an unresolved position save initiated before completion to repopulate onboarding data after `completeOnboarding` clears it.

### Non-functional Requirements

- Preserve multi-tenant isolation by scoping every database statement through the authenticated tenant.
- Preserve Citus compatibility: the tenant distribution key must be present in the insert/conflict path and no cross-tenant query may be introduced.
- Keep transactions limited to database work; do not add network or other slow external calls while locks are held.
- Maintain existing error semantics: genuine progress persistence failures still cause their owning action/transaction to fail, while step-position-only failures remain best effort.
- Do not weaken database timeout guardrails.

## Data / API / Integrations

- No schema change is required. `tenant_settings.tenant` is already the primary key and `onboarding_data` is JSONB.
- The atomic patch should be implemented as a tenant-scoped insert with conflict handling that merges `COALESCE(existing onboarding_data, '{}'::jsonb)` with the incoming JSONB patch.
- JSONB concatenation must retain the current shallow merge behavior; nested objects are replaced as complete top-level values.
- The transaction-aware primitive should live behind a server-only tenancy export so onboarding code can use it without importing an authenticated server-action facade.
- No external API or appliance configuration change is required.

## Security / Permissions

- Public progress writes remain protected by the existing `withAuth` boundary.
- The internal primitive must not become a client-callable action and must be callable only from trusted server code that already has an authenticated tenant and database handle.
- Callers must pass the tenant from `AuthContext`; arbitrary client-supplied tenant IDs are not accepted.
- Existing onboarding permissions and ticketing authorization remain unchanged.

## Observability

- Retain existing error logging for progress and step-position failures.
- No new metrics, dashboards, or alerts are in scope.
- Automated regression failures should expose PostgreSQL error codes so a reintroduced `55P03` is immediately distinguishable from an assertion failure.

## Risks and Mitigations

- **JSONB merge semantics drift:** SQL JSONB concatenation is shallow. Protect parity with tests covering preserved unrelated keys, overwritten matching keys, null stored data, and omitted undefined fields.
- **Server-action boundary leakage:** placing the primitive in a `'use server'` action module could accidentally expose an infrastructure-oriented function. Put it in a server-only tenancy module/export and test or review the import boundary.
- **False-positive integration coverage:** mocking the progress writer recreates the existing gap. The lock regression must use the real primitive and real migrated database queries.
- **Queue rejection blocks later writes:** contain each queued promise rejection and verify a later position save and completion still run.
- **Lock test is slow or flaky:** use a transaction-local test timeout shorter than the appliance's 8-second guardrail and assert prompt successful completion; do not sleep to coordinate the test.
- **Partial conversion leaves another nested action:** inventory transaction callbacks and add a focused contract assertion or review check that none invokes the public progress action.

## Rollout / Migration

- No database migration or backfill is required.
- Deploy through the normal shared application release process; the fix applies to appliance and hosted installations.
- Keep `server/migrations/20260609120000_set_app_role_db_guardrail_timeouts.cjs` unchanged.
- After deployment to an appliance test environment, run the new-install onboarding smoke test with a valid support email.
- Existing partially completed onboarding data remains compatible because its shape does not change.
- Rollback is a normal application-code rollback; there is no schema state to reverse.

## Decisions

- (2026-08-01) Harden all transaction-wrapped onboarding progress saves, not only the observed ticketing call.
- (2026-08-01) Combine transaction-aware calls with an atomic server-side JSONB patch to address both the self-lock and lost-update risks.
- (2026-08-01) Serialize client step-position saves and settle them before final completion.
- (2026-08-01) Include both automated DB-backed lock regression coverage and a manual new-appliance smoke test.
- (2026-08-01) Preserve the database timeout guardrails and do not rely on retries as the durable fix.

## Open Questions

None.

## Acceptance Criteria (Definition of Done)

1. On a migrated database with a transaction-local lock timeout no greater than the appliance's 8 seconds, completing ticketing with a valid support email succeeds without `55P03`.
2. The committed `tenant_settings` row contains both `settings.supportEmail` and the expected ticketing fields in `onboarding_data`.
3. Every onboarding action that saves progress from inside a transaction uses the transaction-aware primitive with its existing `trx`; none invokes the authenticated public progress action from the transaction callback.
4. If a transaction is deliberately rolled back after a progress patch, that patch and related onboarding mutations are both absent.
5. Two independent, concurrent progress patches to different top-level fields both survive in `onboarding_data`; a patch to an existing field replaces only that field.
6. The public `saveTenantOnboardingProgress` action retains authentication and applies the same atomic patch semantics using a single acquired connection.
7. Step-position writes initiated by one wizard execute serially and in step-change order.
8. Final onboarding waits for pending position writes to settle before it validates, configures ticketing, and clears onboarding data.
9. A rejected position-only save does not block navigation, later position saves, ticketing configuration, or final completion.
10. The existing onboarding resume behavior continues to restore the last successfully persisted step.
11. No schema migration, timeout increase, retry loop, permission change, or visible UX change is introduced.
12. Automated DB-backed, concurrency, rollback, and UI ordering tests pass, and a new appliance installation completes onboarding with a valid support email.
