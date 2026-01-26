import type { Knex } from 'knex';
import type { InvoiceStatus } from '@alga-psa/types';

export const PO_CONSUMPTION_FINALIZED_STATUSES: readonly InvoiceStatus[] = [
  'sent',
  'paid',
  'overdue',
  'prepayment',
  'partially_applied',
];

export function isInvoiceFinalizedForPoConsumption(input: {
  status?: string | null;
  finalized_at?: unknown | null;
}): boolean {
  const normalizedStatus = (input.status ?? '').toString().toLowerCase();
  if (normalizedStatus === 'cancelled') {
    return false;
  }
  if (input.finalized_at) {
    return true;
  }
  return (PO_CONSUMPTION_FINALIZED_STATUSES as readonly string[]).includes(normalizedStatus);
}

export async function getPurchaseOrderConsumedCents(params: {
  knex: Knex;
  tenant: string;
  clientContractId: string;
}): Promise<number> {
  const { knex, tenant, clientContractId } = params;

  const statuses = PO_CONSUMPTION_FINALIZED_STATUSES;
  const row = await knex('invoices')
    .where({ tenant, client_contract_id: clientContractId })
    .andWhereNot('status', 'cancelled')
    .andWhere((builder) => {
      builder.whereNotNull('finalized_at').orWhereIn('status', statuses as readonly string[]);
    })
    .sum<{ sum?: string | number | null }>('total_amount as sum')
    .first();

  const raw = row?.sum ?? 0;
  const numeric = typeof raw === 'string' ? Number(raw) : (raw ?? 0);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
}

export async function getClientContractPurchaseOrderContext(params: {
  knex: Knex;
  tenant: string;
  clientContractId: string;
}): Promise<{
  po_required: boolean;
  po_number: string | null;
  po_amount: number | null;
}> {
  const { knex, tenant, clientContractId } = params;
  const row = await knex('client_contracts')
    .where({ tenant, client_contract_id: clientContractId })
    .select('po_required', 'po_number', 'po_amount')
    .first();

  return {
    po_required: Boolean(row?.po_required ?? false),
    po_number: row?.po_number ?? null,
    po_amount: row?.po_amount != null ? Number(row.po_amount) : null,
  };
}

export function computePurchaseOrderOverage(params: {
  authorizedCents: number;
  consumedCents: number;
  invoiceTotalCents: number;
}): {
  authorizedCents: number;
  consumedCents: number;
  remainingCents: number;
  invoiceTotalCents: number;
  overageCents: number;
} {
  const authorizedCents = Math.trunc(params.authorizedCents);
  const consumedCents = Math.trunc(params.consumedCents);
  const invoiceTotalCents = Math.trunc(params.invoiceTotalCents);

  const remainingCents = authorizedCents - consumedCents;
  const overageCents = Math.max(0, invoiceTotalCents - remainingCents);

  return {
    authorizedCents,
    consumedCents,
    remainingCents,
    invoiceTotalCents,
    overageCents,
  };
}
