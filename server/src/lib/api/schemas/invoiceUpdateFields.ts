/**
 * Field classification for the invoice REST update surface (PUT /api/v1/invoices/{id}).
 *
 * `invoice:update` permits editing billing terms only. Everything that belongs to the
 * invoice lifecycle, identity or money is owned by a dedicated command with its own
 * permission and is NOT writable through InvoiceService.update.
 *
 * Add a new invoice column to exactly one of these lists; the unit test
 * invoiceUpdateFields.test.ts fails until every create-schema key is classified.
 */

/** Editable through update(). Per-field business rules live in InvoiceService.update. */
export const INVOICE_UPDATE_FIELDS = [
  'payment_method', // draft-only billing term
  'billing_profile_id', // locked once payments exist; re-resolves terms on drafts
  'due_date', // billing term; draft-only
  'invoice_date', // billing term; draft-only
  'items', // draft, non-recurring only (kept: integration tests and callers replace draft items)
  'tax_source', // update-only; guarded by changeInvoiceTaxSourceInternal
] as const;

/** Never writable through update(); each has an owning command or engine. */
export const LIFECYCLE_OWNED_FIELDS = [
  'status', // finalize / send / recordPayment / void / refund / bulk status commands
  'tenant', // immutable
  'client_id', // immutable identity
  'invoice_id', // immutable
  'invoice_number', // numbering service at finalize/create
  'finalized_at', // finalize
  'subtotal', // billing engine / tax engine (calculated)
  'tax', // tax engine (calculated)
  'total_amount', // billing engine (calculated)
  'credit_applied', // applyCredit command
  'billing_cycle_id', // billing engine
  'is_manual', // immutable (set at creation)
  'is_prepayment', // immutable (set at creation)
  'billing_period_start', // billing engine
  'billing_period_end', // billing engine
  'recurring_execution_window_kind', // billing engine
  'recurring_cadence_source', // billing engine
  'recurring_service_period_start', // billing engine
  'recurring_service_period_end', // billing engine
  'recurring_invoice_window_start', // billing engine
  'recurring_invoice_window_end', // billing engine
] as const;

export type InvoiceUpdateField = (typeof INVOICE_UPDATE_FIELDS)[number];
export type InvoiceLifecycleOwnedField = (typeof LIFECYCLE_OWNED_FIELDS)[number];
