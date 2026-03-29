# PRD — Stale Code Cleanup: Phases 2c through 2f

- Slug: `stale-code-cleanup-phases-2c-2f`
- Date: `2026-02-17`
- Status: Ready for implementation
- Analysis source: `.ai/stale-code-and-cross-package-analysis.md`

## Summary

Mechanically remove ~30 stale files from `server/src/lib/` that are either orphaned (0 callers), pure re-export shims, or duplicates of code already migrated to `@alga-psa/*` packages. Update ~20 callers to import from packages directly. No behavioral changes.

## Problem

The monorepo migration from monolithic `server/` to NX-based packages has left behind dead code:
- **Orphaned files** with 0 callers that inflate the codebase and confuse developers
- **Re-export shims** that add an unnecessary indirection layer
- **Duplicate files** that exist in both `server/src/lib/` and `packages/` -- risk of diverging implementations

These were identified and verified in the 2026-02-17 audit (see analysis doc).

## Goals

1. Delete ~30 stale files from `server/src/lib/`
2. Update ~20 callers to import directly from `@alga-psa/*` packages
3. Reduce `server/src/lib/email/` to a single re-export barrel file
4. Maintain build green after every task
5. Zero behavioral changes -- all deletions are for code with 0 callers or whose callers are redirected to identical package implementations

## Non-goals

- No new packages created
- No service porting (Phase 2g)
- No cross-package violation fixes (Phase 3)
- No architecture changes
- No test writing -- this is deletion and import-path changes only

## Users and Primary Flows

This is a developer experience improvement. No end-user flows are affected.

## Requirements

### Functional Requirements

**Batch 1 (Phase 2c): Delete orphaned files (0 callers)**

- FR-01: Delete 7 orphaned model files from `server/src/lib/models/`: `role.ts`, `standardServiceType.ts`, `timeSheetComment.ts`, `session.tsx`, `ticketResource.tsx`, `userPreferences.tsx`, `notification.ts`
- FR-02: Delete empty barrel file `server/src/lib/models/index.ts`
- FR-03: Delete 2 orphaned service files from `server/src/lib/services/`: `PasswordResetService.ts`, `taskTypeService.ts`
- FR-04: Delete 9 dead email files from `server/src/lib/email/` that have 0 direct imports and whose package equivalents exist in `@alga-psa/email`

**Batch 2 (Phase 2d): Replace re-export shims**

- FR-05: Delete `server/src/lib/user-actions/userActions.ts` shim, update callers to import from `@alga-psa/users/actions`
- FR-06: Delete `server/src/lib/eventBus/events.ts` shim, update callers to import from `@alga-psa/event-schemas`
- FR-07: Delete `server/src/lib/auth/getSession.ts` shim, update callers to import from `@alga-psa/auth`

**Batch 3 (Phase 2e): Email caller migration**

- FR-08: Migrate 1 caller of `system/SystemEmailService.ts` to `@alga-psa/email`, delete server copy + `system/types.ts`
- FR-09: Migrate 1 caller of `BaseEmailService.ts` to `@alga-psa/email`, delete server copy
- FR-10: Migrate 2 callers of `tenant/templateProcessors.ts` to `@alga-psa/email`, delete server copy + `tenant/` dir
- FR-11: Simplify `server/src/lib/email/index.ts` to pure re-export from `@alga-psa/email`

**Batch 4 (Phase 2f): Model caller migration**

- FR-12: Migrate 9 callers of `internalNotification.ts` to `@alga-psa/notifications`, delete server model
- FR-13: Migrate 3 callers of `document-association.tsx` to `@alga-psa/documents/models`, delete server model
- FR-14: Add `PortalDomainSessionToken` exports to `@alga-psa/auth` barrel, migrate 4 callers, delete server model

### Non-functional Requirements

- Build must be green after every individual task
- No runtime behavioral changes
- Caller counts must be re-verified by grep before each deletion (counts are from 2026-02-17, may have changed)

## Data / API / Integrations

No database, API, or integration changes. Only import paths change.

## Security / Permissions

No security implications. All code changes are import-path redirections to identical implementations.

## Rollout / Migration

No migration needed. Changes are internal to the build system. Ship as a single branch merged to main.

## Acceptance Criteria (Definition of Done)

1. All identified orphaned files are deleted
2. All shim files are deleted and callers updated
3. All email callers migrated to `@alga-psa/email`
4. All model callers migrated to package equivalents
5. `server/src/lib/email/index.ts` is a pure re-export
6. `npm run build` passes
7. No new `eslint` errors introduced
