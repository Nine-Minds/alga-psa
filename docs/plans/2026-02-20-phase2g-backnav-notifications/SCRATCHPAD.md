# Scratchpad: Tax Import Service Porting + BackNav Fix + Notification Reconciliation

## Decisions

1. **Skip adapters and externalTaxImportService** — Moving accounting adapters to `@alga-psa/integrations` creates a circular dependency: integrations→billing→integrations (adapters import `AccountingMappingResolver` etc. from billing; billing imports `QboClientService`/`XeroClientService` from integrations). Deferred to future PR with a strategy to extract shared types to `@alga-psa/types` first.

2. **Adopt package notification email.ts version** — rate limiting is centralized in `TenantEmailService.sendEmail()`, inline check in server version is redundant.

3. **Keep server emailLocaleResolver.ts** — `sendEventEmail.ts` imports it locally. Don't force server infrastructure to import from package.

4. **Delete orphan invoiceAdapters.ts** — zero callers in server; the billing package has its own independent copy at `packages/billing/src/lib/adapters/invoiceAdapters.ts`.

5. **Use `@alga-psa/core` for parseCSV** — csvTaxImportService currently imports from `server/src/lib/utils/csvParser`, but `@alga-psa/core` exports the same function (already used by XeroCsvTaxImportService in the integrations package).

## Key File Paths

### Tax Import Services
- Source: `server/src/lib/services/csvTaxImportValidator.ts` (745 LOC)
- Source: `server/src/lib/services/csvTaxImportService.ts` (595 LOC)
- Source: `server/src/lib/utils/csvFieldNormalizer.ts` (323 LOC)
- Target: `packages/integrations/src/services/` and `packages/integrations/src/lib/`
- Barrel: `packages/integrations/src/services/index.ts` (currently: `export * from './email'`)
- Reference pattern: `packages/integrations/src/services/xeroCsvTaxImportService.ts`
- Caller: `server/src/lib/api/controllers/ApiCSVAccountingController.ts`

### BackNav Fix
- Fix: `packages/ui/src/components/BackNav.tsx` line 7
- Target: `packages/ui/src/context/UnsavedChangesContext.tsx` (identical API)

### Notification Dual-Copies
- Delete: `server/src/lib/notifications/email.ts` (561 LOC)
- Delete: `server/src/lib/notifications/emailChannel.ts` (7 LOC, identical to package)
- Keep: `server/src/lib/notifications/emailLocaleResolver.ts` (255 LOC)
- Keep: `server/src/lib/notifications/emailService.ts` (273 LOC)
- Keep: `server/src/lib/notifications/sendEventEmail.ts` (509 LOC)
- Keep: `server/src/lib/notifications/NotificationAccumulator.ts` (459 LOC)
- Package barrel: `packages/notifications/src/index.ts` — add `getEmailNotificationService` export
- Package email.ts: `packages/notifications/src/notifications/email.ts` (504 LOC)
- Package emailChannel: `packages/notifications/src/emailChannel.ts` (already in barrel)

### Orphan Deletion
- Delete: `server/src/lib/adapters/invoiceAdapters.ts` (0 callers)

## Discoveries

### Circular Dependency: Adapters ↔ Billing
- `server/src/lib/adapters/accounting/quickBooksOnlineAdapter.ts` imports from `@alga-psa/billing` (AccountingMappingResolver, CompanyAccountingSyncService, etc.)
- `server/src/lib/adapters/accounting/xeroAdapter.ts` imports from `@alga-psa/billing` (same)
- `server/src/lib/adapters/accounting/quickBooksCSVAdapter.ts` imports from `@alga-psa/billing`
- `server/src/lib/adapters/accounting/xeroCsvAdapter.ts` imports from `@alga-psa/billing`
- `packages/billing/src/services/companySync/adapters/xeroCompanyAdapter.ts` imports from `@alga-psa/integrations`
- `packages/billing/src/services/companySync/adapters/quickBooksCompanyAdapter.ts` imports from `@alga-psa/integrations`
- Adding `@alga-psa/billing` to integrations package.json → circular dependency

### Type Availability
- `TaxSource`, `IExternalTaxImport`, `IExternalTaxImportResult` — all in `@alga-psa/types` ✓
- `AccountingExportBatch`, `AccountingExportLine` — in `packages/types/src/interfaces/accountingExport.interfaces.ts` but NOT exported from barrel (needed for future adapter migration)
- `parseCSV` — available from `@alga-psa/core` ✓

### Notification Differences
- Server email.ts (561 LOC) vs package email.ts (504 LOC): server has inline rate limiting (lines 399-412) that package removed
- emailLocaleResolver: functionally identical between server (255 LOC) and package (212 LOC), just different import paths
- emailChannel: byte-for-byte identical (7 LOC each)
- Package barrel already exports `emailChannel` but NOT `EmailNotificationService`/`getEmailNotificationService`

## Callers Summary

### csvTaxImportService:
- `server/src/lib/api/controllers/ApiCSVAccountingController.ts` — `getCSVTaxImportService`

### email.ts (EmailNotificationService):
- `server/src/lib/jobs/handlers/expiringCreditsNotificationHandler.ts` — `getEmailNotificationService`

### emailChannel:
- `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` — `getEmailEventChannel`
- `server/src/lib/eventBus/subscribers/projectEmailSubscriber.ts` — `getEmailEventChannel`
- `server/src/lib/eventBus/publishers/index.ts` — `getEmailEventChannel`
- `server/src/lib/api/services/TicketService.ts` — `getEmailEventChannel`
- `server/src/test/integration/ticketEmailDelimiters.test.ts` — `EMAIL_EVENT_CHANNEL`

## Implementation Order

1. Move csvFieldNormalizer.ts → packages/integrations/src/lib/
2. Move csvTaxImportValidator.ts → packages/integrations/src/services/ (update csvFieldNormalizer import)
3. Move csvTaxImportService.ts → packages/integrations/src/services/ (update db, types, parseCSV imports)
4. Update integrations services barrel
5. Update ApiCSVAccountingController.ts caller
6. Delete server copies of tax services + csvFieldNormalizer
7. Fix BackNav.tsx import
8. Add getEmailNotificationService to notifications barrel
9. Update 6 notification callers
10. Delete server email.ts and emailChannel.ts
11. Delete orphan invoiceAdapters.ts
12. Verify build (npm run build && npm run build:shared)

## Gotchas

- `parseCSV` signature: verify `@alga-psa/core`'s `parseCSV` returns `string[][]` (same as server's `csvParser`). XeroCsvTaxImportService uses it with `as string[][]` cast.
- `csvTaxImportValidator.ts` uses `any` type for knex parameter — keep as-is, don't try to type-narrow in this PR.
- The `packages/integrations/src/services/index.ts` currently only exports `./email`. Adding CSV tax exports here. Make sure the export doesn't conflict with any existing names.
- After deleting server emailChannel.ts, verify that `sendEventEmail.ts` doesn't import from it (it doesn't — only imports from `emailLocaleResolver`).

## Commands

```bash
# Verify build after changes
npm run build:shared && npm run build

# Check for remaining boundary violations
grep -r "from 'server/src/lib/services/csvTaxImport" --include="*.ts" --include="*.tsx" | grep -v "docs/"
grep -r "from 'server/src/contexts/UnsavedChangesContext" --include="*.ts" --include="*.tsx" packages/
grep -r "from.*lib/notifications/emailChannel" --include="*.ts" --include="*.tsx" server/src/
grep -r "from.*lib/notifications/email'" --include="*.ts" --include="*.tsx" server/src/
```
