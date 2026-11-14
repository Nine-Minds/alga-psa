/**
 * Update-surface view of the invoice field policy (PUT /api/v1/invoices/{id}).
 * The classification itself lives in invoiceFieldPolicy.ts (one classifier for the
 * create and update surfaces); this module keeps the original exports.
 */
import { INVOICE_FIELD_POLICY, invoiceFieldsByKind } from './invoiceFieldPolicy';
import type { InvoiceLifecycleOwnedField, InvoiceUpdateField } from './invoiceFieldPolicy';

export type { InvoiceLifecycleOwnedField, InvoiceUpdateField };

/** Editable through update(): every field that is `writable` on the update surface. */
export const INVOICE_UPDATE_FIELDS = invoiceFieldsByKind('update', 'writable') as InvoiceUpdateField[];

/** Never writable through update(); each has an owning command or engine. */
export const LIFECYCLE_OWNED_FIELDS = (Object.keys(INVOICE_FIELD_POLICY) as Array<keyof typeof INVOICE_FIELD_POLICY>)
  .filter((key) => INVOICE_FIELD_POLICY[key].update.kind !== 'writable') as InvoiceLifecycleOwnedField[];
