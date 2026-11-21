import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isManualPaymentMethod } from './manualPaymentMethods';

/**
 * Where the money on an `invoice_payments` row came from.
 *
 * A row linked to a LIVE `invoice_payment` mapping belongs to the accounting
 * system (directly, or as one allocation of a multi-invoice provider payment);
 * a tombstoned mapping is a deliberate local unlink and reads as manual again.
 * Of the rest, only the methods a person can key here (plus the accounting
 * providers' own, left on a row by a deliberate unlink) are the MSP's to take
 * back: everything else passed through a payment gateway — Stripe, the
 * alternative-payments webhook, a card processor — and can only go back as a
 * refund there.
 *
 * Shared by the void blocker (invoiceVoidCore) and the payments list / reverse
 * action (invoicePaymentActions) so the two can never disagree about who owns
 * a payment.
 */

export type PaymentSourceKind = 'manual' | 'quickbooks' | 'xero' | 'gateway';

export const PAYMENT_MAPPING_ENTITY_TYPE = 'invoice_payment';

export interface PaymentMappingRef {
  /** tenant_external_entity_mappings.id */
  mappingId: string;
  integrationType: string;
  externalEntityId: string;
  externalRealmId: string | null;
}

export interface InvoicePaymentRow {
  payment_id: string;
  amount: number | string | null;
  payment_method: string | null;
  reference_number: string | null;
  payment_date?: string | null;
  notes?: string | null;
  status?: string | null;
  metadata?: Record<string, any> | null;
}

export interface PaymentSourceDescriptor {
  paymentId: string;
  method: string | null;
  /** Minor units (cents), positive. */
  amountCents: number;
  source: PaymentSourceKind;
  /** Provider-side payment id/reference, when the payment came from one. */
  externalReference?: string;
  /** The live mapping that owns this payment, when there is one. */
  mapping?: PaymentMappingRef;
}

export function paymentSourceForIntegration(integrationType: string | null | undefined): PaymentSourceKind | null {
  if (integrationType === 'xero') return 'xero';
  if (integrationType === 'quickbooks_online' || integrationType === 'quickbooks') return 'quickbooks';
  return null;
}

/**
 * Methods the accounting sync stamps on the rows it lands. A row still
 * carrying one after its mapping was tombstoned is an unlinked accounting
 * payment, not gateway money: it stays the MSP's to reverse here.
 */
const ACCOUNTING_PAYMENT_METHODS: ReadonlySet<string> = new Set([
  'quickbooks',
  'quickbooks_online',
  'xero',
]);

export function providerLabelForSource(source: PaymentSourceKind): string {
  switch (source) {
    case 'quickbooks':
      return 'QuickBooks';
    case 'xero':
      return 'Xero';
    case 'gateway':
      return 'the payment provider';
    default:
      return 'AlgaPSA';
  }
}

/**
 * Live `invoice_payment` mappings covering the given payment rows, keyed by
 * payment id. Two shapes reach the same payment: the mapping names it
 * directly (single-invoice payment), or this invoice is one allocation of a
 * multi-invoice payment and only the allocations list names its row.
 */
export async function loadInvoicePaymentMappings(
  knex: Knex,
  tenant: string,
  invoiceId: string,
  paymentIds: string[]
): Promise<Map<string, PaymentMappingRef>> {
  const byPaymentId = new Map<string, PaymentMappingRef>();
  if (paymentIds.length === 0) {
    return byPaymentId;
  }

  let mappings: any[] = [];
  try {
    mappings = await tenantDb(knex, tenant).table('tenant_external_entity_mappings')
      .where({ alga_entity_type: PAYMENT_MAPPING_ENTITY_TYPE })
      .whereNull('deleted_at')
      .where((builder: any) => builder
        .whereIn('alga_entity_id', paymentIds)
        .orWhereRaw("metadata->'allocations' @> ?::jsonb", [JSON.stringify([{ invoiceId }])]))
      .select('id', 'integration_type', 'external_entity_id', 'external_realm_id', 'alga_entity_id', 'metadata');
  } catch {
    // Unreadable mapping ledger: every payment reads as local, which is the
    // safe direction — it never claims a payment belongs to a provider.
    return byPaymentId;
  }

  for (const mapping of mappings ?? []) {
    const linked = new Set<string>([mapping.alga_entity_id]);
    const allocations = (mapping.metadata as any)?.allocations;
    if (Array.isArray(allocations)) {
      for (const allocation of allocations) {
        if (allocation?.algaPaymentId) linked.add(String(allocation.algaPaymentId));
      }
    }
    for (const paymentId of paymentIds) {
      if (linked.has(paymentId)) {
        byPaymentId.set(paymentId, {
          mappingId: mapping.id,
          integrationType: mapping.integration_type,
          externalEntityId: mapping.external_entity_id,
          externalRealmId: mapping.external_realm_id ?? null,
        });
      }
    }
  }

  return byPaymentId;
}

/**
 * An unmapped row's source, read from the method it was landed with. The
 * manual list is the allow-list on purpose: 'stripe', 'alternative_payments'
 * and any card processor a REST caller names are all gateway money, and
 * treating an unknown method as the MSP's own would offer a reversal for
 * money only the gateway can return. A method-less row never came from one of
 * those paths (each stamps its own), so it reads as manual.
 */
function sourceForMethod(method: string | null | undefined): PaymentSourceKind {
  if (!method) return 'manual';
  return isManualPaymentMethod(method) || ACCOUNTING_PAYMENT_METHODS.has(method) ? 'manual' : 'gateway';
}

export function describePaymentSource(
  row: InvoicePaymentRow,
  mapping: PaymentMappingRef | undefined
): PaymentSourceDescriptor {
  const integrationSource = mapping ? paymentSourceForIntegration(mapping.integrationType) : null;
  const source: PaymentSourceKind = integrationSource ?? sourceForMethod(row.payment_method);

  return {
    paymentId: row.payment_id,
    method: row.payment_method ?? null,
    amountCents: Number(row.amount ?? 0),
    source,
    externalReference: mapping?.externalEntityId ?? row.reference_number ?? undefined,
    ...(mapping ? { mapping } : {}),
  };
}

/** Marker reference carried by every reversal row, keyed on what it offsets. */
export const REVERSAL_REFERENCE_PREFIX = 'reversal:';

export function reversalReferenceFor(paymentRowId: string): string {
  return `${REVERSAL_REFERENCE_PREFIX}${paymentRowId}`;
}

/** Ids named by reversal rows themselves (reference marker or row metadata). */
function reversedIdsFromRows(rows: InvoicePaymentRow[]): Set<string> {
  const reversed = new Set<string>();
  for (const row of rows) {
    const reference = row.reference_number ?? '';
    if (reference.startsWith(REVERSAL_REFERENCE_PREFIX)) {
      reversed.add(reference.slice(REVERSAL_REFERENCE_PREFIX.length));
    }
    const reversedId = (row.metadata as { reversed_payment_id?: string } | null)?.reversed_payment_id;
    if (reversedId) {
      reversed.add(String(reversedId));
    }
  }
  return reversed;
}

/**
 * Payment rows on this invoice that an offsetting reversal has already spent.
 *
 * Two writers reverse payments and they key their rows differently: the
 * user-facing action references the ALGA row it offsets, while the accounting
 * sync references the EXTERNAL payment (`reversal:3547`) with no row metadata
 * and leaves the original row untouched. Reading only the row would therefore
 * miss every reversal the sync wrote and let the same money be credited back a
 * second time, so the `payment_reversal` transaction — which both writers
 * stamp with the row they offset — is read as well. Best-effort: an unreadable
 * table yields what was gathered so far rather than an error.
 */
export async function loadReversedPaymentIds(
  knex: Knex,
  tenant: string,
  invoiceId: string,
  rows?: InvoicePaymentRow[]
): Promise<Set<string>> {
  let paymentRows = rows;
  if (!paymentRows) {
    try {
      paymentRows = await tenantDb(knex, tenant).table('invoice_payments')
        .where({ invoice_id: invoiceId })
        .select('payment_id', 'amount', 'payment_method', 'reference_number', 'status', 'metadata');
    } catch {
      paymentRows = [];
    }
  }

  const reversed = reversedIdsFromRows(paymentRows ?? []);

  try {
    const reversalTxns = await tenantDb(knex, tenant).table('transactions')
      .where({ invoice_id: invoiceId, type: 'payment_reversal' })
      .select('metadata');
    for (const txn of reversalTxns ?? []) {
      const metadata = ((txn as { metadata?: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>;
      // `reversed_payment_row` is the sync's name for it, `reversed_payment_id` ours.
      for (const key of ['reversed_payment_row', 'reversed_payment_id']) {
        const value = metadata[key];
        if (value) reversed.add(String(value));
      }
    }
  } catch {
    // Unreadable transactions table: the row-level markers still stand.
  }

  return reversed;
}

/**
 * Classifies every still-standing payment row on an invoice (positive amount,
 * not a reversal, not already offset by one). Best-effort: an unreadable
 * `invoice_payments` table (older EE installs) yields an empty list rather
 * than an error.
 */
export async function describeInvoicePaymentSources(
  knex: Knex,
  tenant: string,
  invoiceId: string
): Promise<PaymentSourceDescriptor[]> {
  let paymentRows: InvoicePaymentRow[] = [];
  try {
    paymentRows = await tenantDb(knex, tenant).table('invoice_payments')
      .where({ invoice_id: invoiceId })
      .select('payment_id', 'amount', 'payment_method', 'reference_number', 'status', 'metadata');
  } catch {
    return [];
  }

  const reversed = await loadReversedPaymentIds(knex, tenant, invoiceId, paymentRows ?? []);
  const open = (paymentRows ?? []).filter(
    (row) => Number(row.amount ?? 0) > 0 && row.status !== 'reversed' && !reversed.has(row.payment_id)
  );
  if (open.length === 0) {
    return [];
  }

  const mappings = await loadInvoicePaymentMappings(
    knex,
    tenant,
    invoiceId,
    open.map((row) => row.payment_id)
  );

  return open.map((row) => describePaymentSource(row, mappings.get(row.payment_id)));
}
