/**
 * Explicit permission assignments for invoice lifecycle actions. Keep these
 * names exhaustive at the call sites so a new lifecycle action must select a
 * capability rather than inheriting invoice:update.
 */
export const INVOICE_ACTION_CAPABILITY = {
  finalizeInvoice: 'finalize',
  unfinalizeInvoice: 'update',
  hardDeleteInvoice: 'delete',
  deleteDraftInvoice: 'delete',
  voidInvoice: 'void',
} as const;
