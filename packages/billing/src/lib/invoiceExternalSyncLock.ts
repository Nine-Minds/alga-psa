/**
 * Facade for the shared invoice-external-sync row lock. The implementation
 * lives in @alga-psa/db so the generic mapping CRUD in @alga-psa/integrations
 * (which cannot import a vertical feature package) enforces the same lock as
 * the accounting adapters and the onboarding linker. Everything exported here
 * is re-exported unchanged; keep the deep import path stable for existing
 * callers.
 */
export {
  lockInvoiceForExternalSync,
  lockInvoicesForExternalSync,
  ACCOUNTING_EXPORT_INVOICE_CANCELLED,
  ACCOUNTING_EXPORT_INVOICE_NOT_FOUND,
} from '@alga-psa/db';
