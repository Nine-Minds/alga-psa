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
