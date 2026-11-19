import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Where the money on an `invoice_payments` row came from.
 *
 * A row linked to a LIVE `invoice_payment` mapping belongs to the accounting
 * system (directly, or as one allocation of a multi-invoice provider payment);
 * a tombstoned mapping is a deliberate local unlink and reads as manual again.
 * Everything else is what the MSP recorded here — except Stripe, which is the
 * gateway's and can only be undone by a refund.
 *
 * Shared by the void blocker (invoiceVoidCore) and the payments list / reverse
 * action (invoicePaymentActions) so the two can never disagree about who owns
 * a payment.
 */

export type PaymentSourceKind = 'manual' | 'quickbooks' | 'xero' | 'stripe';

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

export function providerLabelForSource(source: PaymentSourceKind): string {
  switch (source) {
    case 'quickbooks':
      return 'QuickBooks';
    case 'xero':
      return 'Xero';
    case 'stripe':
      return 'Stripe';
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

export function describePaymentSource(
  row: InvoicePaymentRow,
  mapping: PaymentMappingRef | undefined
): PaymentSourceDescriptor {
  const integrationSource = mapping ? paymentSourceForIntegration(mapping.integrationType) : null;
  const source: PaymentSourceKind = integrationSource
    ?? (row.payment_method === 'stripe' ? 'stripe' : 'manual');

  return {
    paymentId: row.payment_id,
    method: row.payment_method ?? null,
    amountCents: Number(row.amount ?? 0),
    source,
    externalReference: mapping?.externalEntityId ?? row.reference_number ?? undefined,
    ...(mapping ? { mapping } : {}),
  };
}

/**
 * Classifies every still-standing payment row on an invoice (positive amount,
 * not a reversal). Best-effort: an unreadable `invoice_payments` table (older
 * EE installs) yields an empty list rather than an error.
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
      .select('payment_id', 'amount', 'payment_method', 'reference_number', 'status');
  } catch {
    return [];
  }

  const open = (paymentRows ?? []).filter(
    (row) => Number(row.amount ?? 0) > 0 && row.status !== 'reversed'
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
