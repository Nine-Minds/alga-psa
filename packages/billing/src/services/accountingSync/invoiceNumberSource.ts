import type { Knex } from 'knex';
import { resolveConnectedAccountingIntegration } from './connectedAccountingIntegration';

/**
 * Who owns an invoice's number (invoices.invoice_number_source).
 *   alga             - Alga's number is the number of record.
 *   pending_external - provisional; the accounting system will assign it.
 *   external         - the accounting system's number was written back.
 */
export type InvoiceNumberSource = 'alga' | 'pending_external' | 'external';

export function isNumberPendingExternal(invoice: { invoice_number_source?: string | null } | null | undefined): boolean {
  return invoice?.invoice_number_source === 'pending_external';
}

/**
 * Decide the numbering mode a newly finalized invoice records (alga-2026-0002746).
 *
 * `pending_external` only when the invoice type exports to Xero (not a
 * prepayment, not a credit note) and the connected integration resolves to a
 * Xero organisation listed in "Let Xero assign invoice numbers". Everything
 * else - including every tenant that never turned the setting on - is `alga`.
 *
 * The export target is a Xero *connection id*, while the setting stores the
 * Xero organisation id (the numbering sequence belongs to the organisation),
 * so the connection is mapped to its organisation before matching. A listed
 * connection id is honoured too.
 */
export async function resolveInitialInvoiceNumberSource(
  trx: Knex | Knex.Transaction,
  tenant: string,
  invoice: { invoice_type?: string | null; is_prepayment?: boolean | null },
  handlingKind: string | null | undefined
): Promise<InvoiceNumberSource> {
  if (
    handlingKind === 'negative_total' ||
    handlingKind === 'prepayment' ||
    invoice.invoice_type === 'credit_note' ||
    invoice.invoice_type === 'prepayment' ||
    invoice.is_prepayment
  ) {
    return 'alga';
  }

  // Cheap short-circuit: a tenant that never enabled the mode has no list, so
  // no credentials are loaded and no integration is resolved at finalize.
  const { getXeroAssignedNumberingRealms } = await import('@alga-psa/integrations/lib/xero/xeroInvoiceNumberingSettings');
  const realms = await getXeroAssignedNumberingRealms(trx, tenant);
  if (realms.length === 0) {
    return 'alga';
  }

  const integration = await resolveConnectedAccountingIntegration(trx as Knex, tenant);
  if (!integration || integration.adapterType !== 'xero') {
    return 'alga';
  }
  if (realms.includes(integration.targetRealm)) {
    return 'pending_external';
  }

  const { getStoredXeroConnections } = await import('@alga-psa/integrations/lib/xero/xeroClientService');
  const connections = await getStoredXeroConnections(tenant).catch(() => ({} as Record<string, { xeroTenantId?: string }>));
  const organisationId = connections[integration.targetRealm]?.xeroTenantId;
  return organisationId && realms.includes(organisationId) ? 'pending_external' : 'alga';
}
