/**
 * Single field classifier for the invoice REST write surfaces
 * (POST /api/v1/invoices = 'create', PUT /api/v1/invoices/{id} = 'update').
 *
 * Every invoice column is classified exactly once per surface. Lifecycle, identity and
 * money belong to dedicated commands or to the engine, never to the request body.
 * Add a new invoice column to INVOICE_FIELD_POLICY; invoiceFieldPolicy.test.ts fails
 * until every create/base schema key is classified.
 */

export type InvoiceSurface = 'create' | 'update';

export type FieldDisposition =
  | { kind: 'writable' } // accepted from the body
  | { kind: 'command-owned'; command: string } // only the named command may set it
  | { kind: 'immutable'; reason: string } // never changes via this surface
  | { kind: 'engine-derived'; derive: string }; // server computes it; body value ignored

export interface InvoiceFieldRule {
  create: FieldDisposition;
  update: FieldDisposition;
  /**
   * Create only: the single non-default value a command-owned field may carry
   * (a draft invoice with no credit applied). Anything else is rejected.
   */
  createAllows?: readonly unknown[];
}

const writable = { kind: 'writable' } as const;
const owned = (command: string) => ({ kind: 'command-owned', command }) as const;
const derived = (derive: string) => ({ kind: 'engine-derived', derive }) as const;
const immutable = (reason: string) => ({ kind: 'immutable', reason }) as const;

export const INVOICE_FIELD_POLICY = {
  // --- billing terms: writable on both surfaces ---
  payment_method: { create: writable, update: writable },
  billing_profile_id: { create: writable, update: writable },
  due_date: { create: writable, update: writable },
  invoice_date: { create: writable, update: writable },
  items: { create: writable, update: writable },
  tax_source: { create: owned('changeInvoiceTaxSource'), update: writable },

  // --- identity / provenance ---
  client_id: { create: writable, update: immutable('invoice identity') },
  tenant: { create: immutable('forced from the request context'), update: immutable('tenant') },
  invoice_id: { create: immutable('generated'), update: immutable('invoice identity') },
  invoice_number: { create: immutable('numbering service'), update: owned('numbering service') },
  is_manual: { create: writable, update: immutable('set at creation') },
  is_prepayment: { create: writable, update: immutable('set at creation') },
  billing_cycle_id: { create: owned('invoiceGeneration'), update: owned('billing engine') },
  billing_period_start: { create: writable, update: owned('billing engine') },
  billing_period_end: { create: writable, update: owned('billing engine') },
  recurring_execution_window_kind: { create: writable, update: owned('billing engine') },
  recurring_cadence_source: { create: writable, update: owned('billing engine') },
  recurring_service_period_start: { create: writable, update: owned('billing engine') },
  recurring_service_period_end: { create: writable, update: owned('billing engine') },
  recurring_invoice_window_start: { create: writable, update: owned('billing engine') },
  recurring_invoice_window_end: { create: writable, update: owned('billing engine') },

  // --- lifecycle and money ---
  status: {
    create: owned('finalize'),
    update: owned('finalize / send / recordPayment / void / refund'),
    createAllows: ['draft'],
  },
  finalized_at: { create: owned('finalize'), update: owned('finalize') },
  credit_applied: { create: owned('applyCredit'), update: owned('applyCredit'), createAllows: [0] },
  subtotal: { create: derived('sum of charge net amounts'), update: owned('billing engine') },
  tax: { create: derived('tax engine over charges'), update: owned('tax engine') },
  total_amount: { create: derived('subtotal + tax'), update: owned('billing engine') },
} as const satisfies Record<string, InvoiceFieldRule>;

type PolicyKey = keyof typeof INVOICE_FIELD_POLICY;
type UpdateKeys<Writable extends boolean> = {
  [K in PolicyKey]: (typeof INVOICE_FIELD_POLICY)[K]['update']['kind'] extends 'writable'
    ? (Writable extends true ? K : never)
    : (Writable extends true ? never : K);
}[PolicyKey];

/** Update-surface fields that are writable (the former INVOICE_UPDATE_FIELDS). */
export type InvoiceUpdateField = UpdateKeys<true>;
/** Update-surface fields owned by a command / immutable (the former LIFECYCLE_OWNED_FIELDS). */
export type InvoiceLifecycleOwnedField = UpdateKeys<false>;

export interface ForbiddenInvoiceField {
  key: string;
  disposition: FieldDisposition;
  /** Owning command, when there is one (for the error message). */
  command?: string;
}

/**
 * Update surface: every submitted field must be `writable`; anything else is rejected
 * (unknown keys are reported by the caller). Create surface: `command-owned` and
 * `immutable` fields are rejected unless the value is the field's allowed default
 * (`createAllows`); `engine-derived` fields are tolerated and ignored by the service;
 * `immutable` ones like `tenant` are overridden by the service, so they are not
 * rejected either.
 */
export function checkInvoicePayload(
  surface: InvoiceSurface,
  data: Record<string, unknown> | null | undefined,
): { forbidden: ForbiddenInvoiceField[] } {
  const forbidden: ForbiddenInvoiceField[] = [];
  for (const key of Object.keys(data ?? {})) {
    const value = (data as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const rule = (INVOICE_FIELD_POLICY as Record<string, InvoiceFieldRule>)[key];
    if (!rule) continue; // unknown keys are the caller's concern
    const disposition = rule[surface];
    if (disposition.kind === 'writable') continue;
    if (surface === 'create') {
      if (disposition.kind === 'engine-derived') continue; // ignored, never persisted
      if (key === 'tenant' || key === 'invoice_id') continue; // overridden by the service
      if (rule.createAllows?.some((allowed) => (typeof allowed === 'number' ? Number(value) === allowed : allowed === value))) {
        continue;
      }
    }
    forbidden.push({
      key,
      disposition,
      command: disposition.kind === 'command-owned' ? disposition.command : undefined,
    });
  }
  return { forbidden };
}

/** Keys of a surface with the given disposition kind. */
export function invoiceFieldsByKind(surface: InvoiceSurface, kind: FieldDisposition['kind']): string[] {
  return Object.entries(INVOICE_FIELD_POLICY)
    .filter(([, rule]) => (rule as InvoiceFieldRule)[surface].kind === kind)
    .map(([key]) => key);
}
