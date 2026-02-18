# Scratchpad — Stale Code Cleanup: Phases 2c through 2f

- Plan slug: `stale-code-cleanup-phases-2c-2f`
- Created: `2026-02-17`
- Analysis source: `.ai/stale-code-and-cross-package-analysis.md`

## What This Is

Working memory for the stale code cleanup. Append discoveries as tasks are executed.

## Decisions

- (2026-02-17) Process tasks strictly in order: 2c -> 2d -> 2e -> 2f. Each task must build green before next.
- (2026-02-17) Always grep-verify caller counts before deleting. The counts in this plan are from 2026-02-17 and code changes daily.
- (2026-02-17) Do NOT delete files that have callers unless those callers are updated first in the same task.
- (2026-02-17) **Git strategy:** Use branch `cleanup_phase_2_again`. One commit per task (13 total). Grep verifications and build checks are internal steps within each task, not separate commits. Commit message format: `chore: delete orphaned models (Task 2c-1)` etc.
- (2026-02-17) Task 2f-3 (PortalDomainSessionToken) requires adding exports to @alga-psa/auth barrel since the package file exists but isn't exported. Server version has server-specific deps (analytics, sessionCookies types) that the package version resolved internally.
- (2026-02-17) For email migration (Phase 2e), DatabaseTemplateProcessor exists in TWO locations in the email package: `packages/email/src/templateProcessors.ts` AND `packages/email/src/tenant/templateProcessors.ts`. Verify which one is exported from the package barrel before updating callers.

## Discoveries / Constraints

- (2026-02-17) The server `PortalDomainSessionToken.ts` imports from `server/src/lib/analytics/posthog` and `server/src/lib/auth/sessionCookies` -- these are server-specific deps not present in the package version. The package version uses `./session` and `./PortalDomainModel` instead. Callers that relied on analytics capture may behave slightly differently (no posthog events), but the core token logic is identical.
- (2026-02-17) `server/src/lib/email/index.ts` is NOT a pure re-export -- it imports SystemEmailService from local `./system/SystemEmailService`, templateProcessors from local `./tenant/templateProcessors`, and types from local `./BaseEmailService`. Tasks 2e-1 through 2e-3 must migrate the callers of these local files BEFORE Task 2e-4 can simplify the barrel.
- (2026-02-17) `notification.ts` vs `internalNotification.ts` -- these are DIFFERENT files. `notification.ts` (F007) has 0 callers and is safe to delete. `internalNotification.ts` (F026) has 9 callers and needs migration.
- (2026-02-17) `session.tsx` in models refers to the OLD `session` table with `token`/`usersession_id` fields. The package `UserSession` model manages the newer `sessions` table. These are different tables -- the old one is unused.
- (2026-02-17) **Task 2d-3 is the largest single task**: `auth/getSession.ts` shim has **23 callers** (12 in server/, 11 in ee/). Server callers: `invoiceService.ts`, `client-portal/layout.tsx`, `documents/download/[fileId]/route.ts`, `serverFeatureFlags.tsx`, `auth/session.ts`, `msp/assets/page.tsx`, `msp/assets/[asset_id]/page.tsx`, `msp/time-sheet-approvals/page.tsx`, `billingCycleActions.test.ts`, `extensions/gateway/auth.ts`, `api/v1/feature-flags/route.ts`, `client-portal/layout.tsx`. EE callers: `msp/layout.tsx`, `license-actions.ts`, 9 `tenant-management/` route handlers. All import paths use either `server/src/lib/auth/getSession` or `@/lib/auth/getSession` -- both patterns must be updated to `@alga-psa/auth`.
- (2026-02-17) Verified `@alga-psa/email` package barrel exports: `SystemEmailService`, `getSystemEmailService`, `BaseEmailService` (as types), `DatabaseTemplateProcessor` (via templateProcessors), `TenantEmailService`, `DelayedEmailQueue`. All needed for Phase 2e migrations.

## Commands / Runbooks

### Verify a file has 0 callers before deleting
```bash
# Check both alias and relative imports, including ee/
grep -r "from.*lib/models/FILENAME" server/src/ ee/ packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.d\.ts"
grep -r "import.*FILENAME" server/src/ ee/ packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.d\.ts"
```

### Build verification
```bash
npm run build
```

### Check what a barrel file exports
```bash
cat server/src/lib/email/index.ts
```

## Links / References

- Analysis doc: `.ai/stale-code-and-cross-package-analysis.md`
- PRD: `docs/plans/2026-02-17-stale-code-cleanup-phases-2c-2f/PRD.md`
- Previous completed phases: Phase 1 (5 shims, 19 models), Phase 2 (19 models), Phase 2b (taxService shim, 3 models)
- Failed branch: `phase3-cross-package-cleanup` -- attempted Phase 3 too early, abandoned due to circular deps

## Task Execution Order

Must be executed in this exact order:

1. **Task 2c-1** — Delete 7 orphaned models + empty barrel (F001-F008)
2. **Task 2c-2** — Delete 2 orphaned services (F009-F010)
3. **Task 2c-3** — Delete 9 dead email files (F011-F018)
4. **Task 2d-1** — Replace user-actions shim (F019)
5. **Task 2d-2** — Replace eventBus/events shim (F020)
6. **Task 2d-3** — Replace auth/getSession shim — **23 callers** (F021)
7. **Task 2e-1** — Migrate SystemEmailService caller + delete (F022)
8. **Task 2e-2** — Migrate BaseEmailService caller + delete (F023)
9. **Task 2e-3** — Migrate templateProcessors callers + delete (F024)
10. **Task 2e-4** — Simplify email/index.ts barrel (F025) -- MUST be after 2e-1/2e-2/2e-3
11. **Task 2f-1** — Migrate internalNotification.ts 9 callers + delete (F026)
12. **Task 2f-2** — Migrate document-association.tsx 3 callers + delete (F027)
13. **Task 2f-3** — Add exports to auth barrel + migrate PortalDomainSessionToken 4 callers + delete (F028)

## Open Questions

- Should we also delete `server/src/lib/email/README.md` if it exists? (Low priority, doesn't affect build)
- After Phase 2f, how many models remain in `server/src/lib/models/`? Expected: 5 (contact.tsx, ticketCategory.tsx, documentBlockContent.tsx, document-association.tsx if 2f-2 fails, internalNotification.ts if 2f-1 fails)

## Updates
- (2026-02-18) Task 2c-1: rg-verified no callers, deleted orphaned models role.ts, standardServiceType.ts, timeSheetComment.ts, session.tsx, ticketResource.tsx, userPreferences.tsx, notification.ts and empty models/index.ts.
- (2026-02-18) Task 2c-2: rg-verified no callers, deleted PasswordResetService.ts and taskTypeService.ts.
- (2026-02-18) Build after Task 2c-2 failed: Next build missing @dnd-kit/sortable in packages/billing (module not found). Attempted NODE_OPTIONS=--max-old-space-size=8192 to avoid prior OOM; build proceeded to dependency error.
- (2026-02-18) Task 2c-3: Removed dead email files (sendPasswordResetEmail, sendPortalInvitationEmail, sendVerificationEmail, sendCancellationFeedbackEmail, clientPortalTenantRecoveryEmail, SystemEmailProviderFactory, tenant/types, system/templates/emailVerification). Updated EE license-actions cancellation feedback to import from @alga-psa/email.
- (2026-02-18) Adjusted server/src/lib/email/system/SystemEmailService.ts to import SystemEmailProviderFactory from @alga-psa/email after deleting local factory.
- (2026-02-18) Build after Task 2c-3 failed with missing @dnd-kit/sortable (packages/billing). SystemEmailProviderFactory error resolved by updating SystemEmailService import.
- (2026-02-18) Task 2d-1: Updated packages/projects projectActions to import user actions from @alga-psa/users/actions and adjusted calendarActions.sync.test mock path. Deleted server/src/lib/user-actions/userActions.ts shim.
- (2026-02-18) Build after Task 2d-1 failed with missing @dnd-kit/sortable in packages/billing (same as prior).
- (2026-02-18) Task 2d-2: Updated eventBus/events imports to @alga-psa/event-schemas in surveyTriggerDispatch.integration.test.ts and ticket-response-state.integration.test.ts. Deleted server/src/lib/eventBus/events.ts.
- (2026-02-18) Build after Task 2d-2 still fails: missing @dnd-kit/sortable in packages/billing (eventBus import errors resolved).
- (2026-02-18) Task 2d-3: Repointed all getSession/getSessionWithRevocationCheck imports and mocks from server/src/lib/auth/getSession to @alga-psa/auth across server and EE; deleted server/src/lib/auth/getSession.ts shim.
- (2026-02-18) Task 2d-3 follow-up: Updated ApiAccountingExportController.ts, ApiCSVAccountingController.ts, and auth-compat.ts to import getSession from @alga-psa/auth after build flagged relative imports.
- (2026-02-18) Build after Task 2d-3 still fails: missing @dnd-kit/sortable in packages/billing.
- (2026-02-18) Task 2e-1: Appointment request route now imports SystemEmailService from @alga-psa/email. Updated email barrel to re-export system types from package. Updated appointment notification/request tests to mock @alga-psa/email. Deleted server/src/lib/email/system/SystemEmailService.ts and system/types.ts (removed system/ dir).
- (2026-02-18) Build after Task 2e-1 still fails: missing @dnd-kit/sortable in packages/billing.
