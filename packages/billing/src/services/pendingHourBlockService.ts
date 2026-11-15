import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { toCalendarDateString } from '@alga-psa/core';

export interface CreatePendingHourBlockForInvoiceChargeInput {
  tenant: string;
  clientId: string;
  serviceId: string;
  minutes: number;
  hourlyRate: number;
  purchaseAmount: number;
  /** Required: callers must pass the owning currency explicitly (contract currency for contract blocks). */
  currencyCode: string;
  invoiceId: string;
  invoiceChargeId: string;
  expirationDate?: string | Date | null;
  scopeServiceIds?: string[];
  sourceType: 'purchase' | 'contract';
  contractLineId?: string | null;
  clientContractId?: string | null;
  issuanceId?: string | null;
  /** Cadence blocks: the recurring_service_periods row (charge_family 'prepaid_block') that issued the block. */
  servicePeriodRecordId?: string | null;
  /** First day the block may be drawn (cadence blocks: service period start). Null = unbounded. */
  validFrom?: string | Date | null;
  replenishmentBucketUsageId?: string | null;
  createdBy?: string | null;
  notes?: string | null;
}

/**
 * Insert a `pending` hour block linked to an invoice charge, plus its service
 * scope rows. Finalizing the invoice activates the block (and writes the
 * `purchase` audit row); no audit row is written at creation.
 */
export async function createPendingHourBlockForInvoiceCharge(
  trx: Knex.Transaction,
  input: CreatePendingHourBlockForInvoiceChargeInput,
): Promise<{ blockId: string }> {
  if (!input.currencyCode) {
    throw new Error('currencyCode is required to create a pending hour block');
  }
  const { tenant } = input;
  const db = tenantDb(trx, tenant);
  const blockId = uuidv4();
  await db.table('hour_blocks').insert({
    block_id: blockId,
    tenant,
    client_id: input.clientId,
    service_id: input.serviceId,
    total_minutes: input.minutes,
    remaining_minutes: input.minutes,
    hourly_rate: Math.round(input.hourlyRate),
    purchase_amount: input.purchaseAmount,
    currency_code: input.currencyCode,
    status: 'pending',
    purchased_at: null,
    expiration_date: toCalendarDateString(input.expirationDate),
    source_invoice_id: input.invoiceId,
    source_invoice_charge_id: input.invoiceChargeId,
    replenishment_bucket_usage_id: input.replenishmentBucketUsageId ?? null,
    source_type: input.sourceType,
    contract_line_id: input.contractLineId ?? null,
    client_contract_id: input.clientContractId ?? null,
    issuance_id: input.issuanceId ?? null,
    service_period_record_id: input.servicePeriodRecordId ?? null,
    valid_from: toCalendarDateString(input.validFrom),
    created_by: input.createdBy ?? null,
    notes: input.notes?.trim() || null,
  });
  if (input.scopeServiceIds && input.scopeServiceIds.length > 0) {
    await db.table('hour_block_service_scopes').insert(
      input.scopeServiceIds.map((serviceId) => ({ tenant, block_id: blockId, service_id: serviceId })),
    );
  }
  return { blockId };
}
