# Scratchpad — Transaction-Safe Onboarding Progress Persistence

- Plan slug: `2026-08-01-onboarding-progress-transaction-safety`
- Created: 2026-08-01

## What This Is

Working notes for eliminating lock timeouts and lost updates when onboarding actions persist tenant-wide wizard progress.

## Decisions

- (2026-08-01) Keep the plan generic to all installations. A new appliance installation exposed the defect because the application role has an 8-second `lock_timeout`, but the faulty transaction/connection pattern is shared application code.
- (2026-08-01) Do not treat a retry or a larger `lock_timeout` as the durable correction. The plan must remove the re-entrant write and preserve the database guardrail.
- (2026-08-01, confirmed) Harden every current transaction-wrapped onboarding progress save, not only `configureTicketing`.
- (2026-08-01, confirmed) Use both an atomic server-side JSONB patch and a client-side serialized step-position queue that is settled before completion.
- (2026-08-01, confirmed) Require automated DB-backed regression coverage and a manual new-appliance smoke test.
- (2026-08-01, implementation) Keep the authenticated action as the non-transactional facade and export the caller-owned primitive only through `@alga-psa/tenancy/server`.

## Discoveries / Constraints

- (2026-08-01) `configureTicketing` opens a transaction in `packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts` and writes `tenant_settings.settings.supportEmail` near the end of that transaction.
- (2026-08-01) Before the transaction commits, `configureTicketing` invokes the authenticated `saveTenantOnboardingProgress` action. That action calls `getTenantSettings()` and `createTenantKnex()`, so its read/merge/write occurs through connections outside the caller's transaction.
- (2026-08-01) With a valid support email, the outer transaction owns the tenant's `tenant_settings` row lock while the inner update waits for that same row. PostgreSQL aborts the waiting statement with `55P03` when the application role's 8-second `lock_timeout` expires.
- (2026-08-01) The appliance guardrail is defined by `server/migrations/20260609120000_set_app_role_db_guardrail_timeouts.cjs`; it sets `lock_timeout=8s` and should remain unchanged.
- (2026-08-01) `saveTenantOnboardingProgress` performs a non-atomic read/merge/write. Concurrent patches can read the same old JSON and overwrite one another, so this is also a lost-update risk independent of the self-lock.
- (2026-08-01) `OnboardingWizard` starts `saveOnboardingStepPosition(currentStep)` without awaiting or serializing it whenever the current step changes. It is another potential concurrent writer of `tenant_settings.onboarding_data`.
- (2026-08-01) Several onboarding actions invoke `saveTenantOnboardingProgress` from inside a transaction. Ticketing is the proven self-lock because it writes `tenant_settings` first; a transaction-aware internal helper can remove the nested-action/connection pattern consistently at all transactional call sites.
- (2026-08-01) `tenant_settings.tenant` is the primary key and `onboarding_data` is JSONB, so an atomic tenant-scoped insert/upsert with a JSONB patch merge is feasible without a schema migration.
- (2026-08-01) The existing DB-backed test `server/src/test/integration/onboardingBoardTicketStatuses.integration.test.ts` mocks the progress action. It verifies the support email but cannot reproduce or prevent the lock cycle.
- (2026-08-01) Existing UI coverage in `server/src/test/unit/onboarding/onboardingWizardStepRestore.test.tsx` verifies that step positions are sent, but not that requests are serialized or drained before final completion.
- (2026-08-01) The worktree already contains an unrelated modification to `package-lock.json`; preserve it.
- (2026-08-01, implementation) `saveClientInfo`, `addTeamMembers`, `setupBilling`, and `configureTicketing` are the four transaction-owning progress writers; all now call `persistTenantOnboardingProgress(trx, tenant, patch)`.
- (2026-08-01, verification) The wire-in `.env.localtest` stores Docker secret paths, but this Vitest runtime cannot load the filesystem secret provider. DB tests must receive `DB_PASSWORD_ADMIN` and `DB_PASSWORD_SERVER` from the copied `../secrets/*` files in their process environment.
- (2026-08-01, verification) Full server TypeScript checking exceeds 8 GiB of V8 heap in this checkout; `node --max-old-space-size=16384 node_modules/typescript/bin/tsc --noEmit -p server/tsconfig.json` completes successfully.
- (2026-08-01, verification) The active workflow port is 3134. Hocuspocus is intentionally excluded from this task's stack gate by human direction recorded on the workflow card.
- (2026-08-01, verification) A local runtime build starts on port 3134 and `/auth/msp/signin` returns HTTP 200. The shared wire-in database is behind current schema and background schedulers warn that `tenants.suspended_at` is missing; this does not block the onboarding compile/test checks but should not be mistaken for a branch regression.
- (2026-08-01, mitigation) Replaced the T007 source-string contract with a behavioral action test that invokes all four transaction-owning flows and verifies each passes the active transaction to the internal progress writer without calling the public action.
- (2026-08-02, mitigation) Fresh tenant settings can store `onboarding_data` as JSONB literal `null`, which SQL `COALESCE` does not treat as SQL NULL. The atomic patch now normalizes both forms to an empty object, with distinct DB-backed coverage for literal-null step persistence.

## Selected Design

- Add a non-server-action persistence primitive in the tenancy package that accepts a tenant-scoped `Knex` connection or transaction plus the tenant ID and a partial `WizardData` patch.
- Make the primitive perform one tenant-scoped atomic JSONB patch/upsert rather than a separate select followed by update/insert.
- Keep `saveTenantOnboardingProgress` as the authenticated public action facade; have it obtain one connection and delegate to the primitive.
- Have transaction-owning onboarding actions call the primitive with their existing `trx` and authenticated tenant instead of invoking the public action.
- Serialize step-position saves in the wizard and await the pending save before ticketing completion, while keeping a failed position-only save non-fatal to navigation.

## Commands / Runbooks

- Inspect relevant paths: `rg -n "saveTenantOnboardingProgress|saveOnboardingStepPosition|configureTicketing|tenant_settings" packages/onboarding packages/tenancy server/src/test`.
- Focused current tests include `server/src/test/integration/onboardingBoardTicketStatuses.integration.test.ts` and `server/src/test/unit/onboarding/onboardingWizardStepRestore.test.tsx`.
- Planned regression verification should execute real queries against the migrated schema and use an 8-second-or-lower session/transaction `lock_timeout` so the test fails quickly if a second connection reappears.
- Focused UI regression: `cd server && npx vitest run src/test/unit/onboarding/onboardingWizardStepRestore.test.tsx --coverage.enabled=false`.
- Focused package regression: `cd packages/onboarding && npm test`; `cd packages/tenancy && npm test`.
- DB regressions (wire-in target Postgres on 5472): export the copied admin/app passwords from `../secrets/postgres_password` and `../secrets/db_password_server`, then run `npx vitest run src/test/integration/onboardingProgressPersistence.integration.test.ts src/test/integration/onboardingBoardTicketStatuses.integration.test.ts --coverage.enabled=false` from `server/`.
- Full server typecheck: `node --max-old-space-size=16384 node_modules/typescript/bin/tsc --noEmit -p server/tsconfig.json` from the repository root.

## Implementation Status

- (2026-08-01) Automated implementation and regressions are complete: plan features F001-F023 and tests T001-T011 are marked implemented.
- (2026-08-01) Fresh-appliance validation remains for the later smoke-test step, so F024 and T012 remain unimplemented.
- (2026-08-02, mitigation verification) The focused persistence and ticketing DB suites pass 7/7, including JSONB literal-null restoration and a transaction-local 2-second `lock_timeout`; the focused action/wizard unit suites pass 10/10; the full server TypeScript check passes with the documented 16 GiB heap.

## Links / References

- `packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts`
- `packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts`
- `packages/onboarding/src/components/OnboardingWizard.tsx`
- `server/migrations/20260609120000_set_app_role_db_guardrail_timeouts.cjs`
- `server/migrations/20250630161508_create_tenant_settings_table.cjs`
- `server/src/test/integration/onboardingBoardTicketStatuses.integration.test.ts`
- `server/src/test/unit/onboarding/onboardingWizardStepRestore.test.tsx`

## Open Questions

None. Scope decisions were confirmed on 2026-08-01.
