# PRD: Tax Import Service Porting + BackNav Fix + Notification Reconciliation

**Date:** 2026-02-20
**PR scope:** Single PR combining 3 cleanup items from the ongoing server-to-package migration

---

## Problem Statement

The codebase has accumulated stale code patterns from the server-to-package migration:

1. **CSV tax import services** remain in `server/src/lib/services/` despite having a natural home in `@alga-psa/integrations` (where `XeroCsvTaxImportService` already lives as a reference)
2. **BackNav.tsx** has a package-to-server boundary violation — imports `UnsavedChangesContext` from `server/src/contexts/` despite an identical copy already existing in the same package at `packages/ui/src/context/`
3. **Notification email files** are duplicated between `server/src/lib/notifications/` and `packages/notifications/src/notifications/` with diverged implementations (server has inline rate limiting that's been centralized elsewhere)
4. **An orphan file** `server/src/lib/adapters/invoiceAdapters.ts` has zero callers

## Goals

- Port `csvTaxImportValidator.ts` and `csvTaxImportService.ts` (+ dependency `csvFieldNormalizer.ts`) to `@alga-psa/integrations`
- Fix BackNav.tsx boundary violation (1 import change)
- Reconcile notification dual-copies: delete server `email.ts` and `emailChannel.ts`, update callers to use package versions
- Delete orphan `server/src/lib/adapters/invoiceAdapters.ts`

## Non-Goals

- Moving `externalTaxImportService.ts` (depends on accounting adapters which have a circular dependency with `@alga-psa/billing` — deferred)
- Moving accounting adapters from `server/src/lib/adapters/accounting/` (circular dep: integrations→billing→integrations — needs separate strategy)
- Moving `accountingExportService.ts` to a package (has many server-internal deps)
- Moving notification server-only files (`emailService.ts`, `sendEventEmail.ts`, `NotificationAccumulator.ts`)
- Deleting server `emailLocaleResolver.ts` (still imported locally by `sendEventEmail.ts`)
- Creating new facade packages

## Detailed Changes

### Work Item 1: CSV Tax Import Services → `@alga-psa/integrations`

**Files to move:**

| Source | Destination | LOC |
|--------|-------------|-----|
| `server/src/lib/utils/csvFieldNormalizer.ts` | `packages/integrations/src/lib/csvFieldNormalizer.ts` | 323 |
| `server/src/lib/services/csvTaxImportValidator.ts` | `packages/integrations/src/services/csvTaxImportValidator.ts` | 745 |
| `server/src/lib/services/csvTaxImportService.ts` | `packages/integrations/src/services/csvTaxImportService.ts` | 595 |

**Import changes needed in moved files:**

| Old Import | New Import | Files Affected |
|-----------|-----------|----------------|
| `createTenantKnex` from `../db` | `@alga-psa/db` | csvTaxImportService |
| `TaxSource` from `../../interfaces/tax.interfaces` | `@alga-psa/types` | csvTaxImportService |
| `parseCSV` from `../utils/csvParser` | `@alga-psa/core` (already used by XeroCsvTaxImportService) | csvTaxImportService |
| `csvFieldNormalizer` from `../utils/csvFieldNormalizer` | `../lib/csvFieldNormalizer` (relative within package) | csvTaxImportValidator |
| `csvTaxImportValidator` from `./csvTaxImportValidator` | stays relative | csvTaxImportService |

**Callers to update:**

| File | Old Import | New Import |
|------|-----------|------------|
| `server/src/lib/api/controllers/ApiCSVAccountingController.ts` | `../../services/csvTaxImportService` | `@alga-psa/integrations/services` |

**Barrel updates:**
- `packages/integrations/src/services/index.ts` — add exports for csvTaxImportValidator, csvTaxImportService

**Package.json:** No new dependencies needed. `@alga-psa/core`, `@alga-psa/db`, `@alga-psa/types` are already in integrations package.json.

### Work Item 2: BackNav.tsx Fix

Single import change in `packages/ui/src/components/BackNav.tsx`:
```diff
- import { UnsavedChangesContext } from 'server/src/contexts/UnsavedChangesContext';
+ import { UnsavedChangesContext } from '../context/UnsavedChangesContext';
```

The context at `packages/ui/src/context/UnsavedChangesContext.tsx` has identical API: `setHasUnsavedChanges`, `hasAnyUnsavedChanges`, `confirmNavigation`, `unregister`, `useUnsavedChanges()`, `useRegisterUnsavedChanges()`.

### Work Item 3: Notification Dual-Copy Reconciliation

**Delete server copies (adopt package versions):**
- `server/src/lib/notifications/email.ts` (561 LOC) — package version (504 LOC) is correct; inline rate limiting was moved to TenantEmailService
- `server/src/lib/notifications/emailChannel.ts` (7 LOC) — identical to package version, already exported from `@alga-psa/notifications` barrel

**Keep in server (not touched):**
- `emailLocaleResolver.ts` — still imported by `sendEventEmail.ts` locally
- `emailService.ts`, `sendEventEmail.ts`, `NotificationAccumulator.ts` — server infrastructure

**Package changes needed:**
- Export `getEmailNotificationService` from `@alga-psa/notifications` barrel (currently only accessible via relative import within package)

**Server callers to update:**

| File | What it imports | New import source |
|------|----------------|------------------|
| `server/src/lib/jobs/handlers/expiringCreditsNotificationHandler.ts` | `getEmailNotificationService` | `@alga-psa/notifications` |
| `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` | `getEmailEventChannel` | `@alga-psa/notifications` |
| `server/src/lib/eventBus/subscribers/projectEmailSubscriber.ts` | `getEmailEventChannel` | `@alga-psa/notifications` |
| `server/src/lib/eventBus/publishers/index.ts` | `getEmailEventChannel` | `@alga-psa/notifications` |
| `server/src/lib/api/services/TicketService.ts` | `getEmailEventChannel` | `@alga-psa/notifications` |
| `server/src/test/integration/ticketEmailDelimiters.test.ts` | `EMAIL_EVENT_CHANNEL` | `@alga-psa/notifications` |

### Work Item 4: Orphan Deletion

Delete `server/src/lib/adapters/invoiceAdapters.ts` — zero callers. The billing package has its own independent copy at `packages/billing/src/lib/adapters/invoiceAdapters.ts`.

## Implementation Order

1. Move `csvFieldNormalizer.ts` to integrations package (prerequisite for validator)
2. Move `csvTaxImportValidator.ts` to integrations package (update csvFieldNormalizer import)
3. Move `csvTaxImportService.ts` to integrations package (update all imports: db, types, parseCSV, validator)
4. Update integrations services barrel to export new modules
5. Update `ApiCSVAccountingController.ts` caller
6. Delete server copies of tax import services + csvFieldNormalizer
7. Fix BackNav.tsx import
8. Add `getEmailNotificationService` export to notifications package barrel
9. Update 6 notification callers to import from `@alga-psa/notifications`
10. Delete server `email.ts` and `emailChannel.ts`
11. Delete orphan `invoiceAdapters.ts`
12. Verify build

## Risks

1. **csvTaxImportService uses `parseCSV` from server utils** — must switch to `@alga-psa/core` (same function, already used by XeroCsvTaxImportService in the same package). Verify function signature compatibility.
2. **Notification rate limiting removal** — The server email.ts had inline rate limiting that the package version doesn't. Risk mitigated: TenantEmailService already handles rate limiting centrally.
3. **Package notifications barrel change** — Adding `getEmailNotificationService` export. Verify no naming conflicts.

## Acceptance Criteria

- [ ] `npm run build` succeeds
- [ ] `npm run build:shared` succeeds
- [ ] `server/src/lib/services/csvTaxImportValidator.ts` deleted
- [ ] `server/src/lib/services/csvTaxImportService.ts` deleted
- [ ] `server/src/lib/utils/csvFieldNormalizer.ts` deleted
- [ ] `server/src/lib/notifications/email.ts` deleted
- [ ] `server/src/lib/notifications/emailChannel.ts` deleted
- [ ] `server/src/lib/adapters/invoiceAdapters.ts` deleted
- [ ] `BackNav.tsx` imports from `../context/UnsavedChangesContext`
- [ ] `packages/integrations/src/services/csvTaxImportValidator.ts` exists
- [ ] `packages/integrations/src/services/csvTaxImportService.ts` exists
- [ ] `packages/integrations/src/lib/csvFieldNormalizer.ts` exists
- [ ] `getEmailNotificationService` importable from `@alga-psa/notifications`
- [ ] Grep for boundary violation patterns returns 0 source matches (outside docs/)

## Deferred Items (future PRs)

These were explored but deferred due to circular dependency blockers:
- **externalTaxImportService.ts** — depends on concrete adapter classes (QuickBooksOnlineAdapter, XeroAdapter) which import from `@alga-psa/billing`
- **Accounting adapters** (7 files, 3,369 LOC) — create circular dep: integrations→billing→integrations. Need to extract shared types to `@alga-psa/types` first, or use runtime subpath strategy.
- **accountingExportAdapter.ts interface types** — candidate for `@alga-psa/types` in future PR
