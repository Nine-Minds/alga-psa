import { createTenantKnex } from 'server/src/lib/db';
import logger from '@alga-psa/core/logger';
import { normalizeClientContract } from '@shared/billingClients/clientContracts';
import type { RenewalWorkItemStatus } from '@alga-psa/types';

export interface RenewalQueueProcessorJobData extends Record<string, unknown> {
  tenantId: string;
  horizonDays?: number;
}

const DEFAULT_RENEWAL_PROCESSING_HORIZON_DAYS = 90;
const KNOWN_RENEWAL_STATUSES: RenewalWorkItemStatus[] = [
  'pending',
  'renewing',
  'non_renewing',
  'snoozed',
  'completed',
];
const toDateOnly = (value: Date): string => value.toISOString().slice(0, 10);
const addDays = (base: Date, days: number): Date => {
  const shifted = new Date(base);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
};
const isKnownRenewalStatus = (value: unknown): value is RenewalWorkItemStatus =>
  typeof value === 'string' && KNOWN_RENEWAL_STATUSES.includes(value as RenewalWorkItemStatus);
const isDateOnly = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const normalizeOptionalDateOnly = (value: unknown): string | null => {
  if (!isDateOnly(value)) return null;
  return value;
};

export async function processRenewalQueueHandler(data: RenewalQueueProcessorJobData): Promise<void> {
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : '';
  if (!tenantId) {
    throw new Error('Tenant ID is required for renewal queue processing job');
  }

  const horizonDays =
    Number.isInteger(data.horizonDays) && (data.horizonDays as number) > 0
      ? Math.trunc(data.horizonDays as number)
      : DEFAULT_RENEWAL_PROCESSING_HORIZON_DAYS;

  const { knex } = await createTenantKnex();
  const schema = knex.schema as any;
  const [
    hasDecisionDueDateColumn,
    hasStatusColumn,
    hasRenewalCycleStartColumn,
    hasRenewalCycleEndColumn,
    hasRenewalCycleKeyColumn,
    hasSnoozedUntilColumn,
    hasCreatedTicketIdColumn,
    hasCreatedDraftContractIdColumn,
    hasDefaultRenewalModeColumn,
    hasDefaultNoticePeriodColumn,
  ] = await Promise.all([
    schema?.hasColumn?.('client_contracts', 'decision_due_date') ?? false,
    schema?.hasColumn?.('client_contracts', 'status') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_cycle_start') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_cycle_end') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_cycle_key') ?? false,
    schema?.hasColumn?.('client_contracts', 'snoozed_until') ?? false,
    schema?.hasColumn?.('client_contracts', 'created_ticket_id') ?? false,
    schema?.hasColumn?.('client_contracts', 'created_draft_contract_id') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'default_renewal_mode') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'default_notice_period_days') ?? false,
  ]);

  if (!hasDecisionDueDateColumn || !hasStatusColumn) {
    logger.info('Skipping renewal queue processing because required columns are unavailable', {
      tenantId,
      hasDecisionDueDateColumn,
      hasStatusColumn,
    });
    return;
  }

  const today = toDateOnly(new Date());
  const horizonDate = toDateOnly(addDays(new Date(), horizonDays));
  const defaultSelections: string[] = [];
  if (hasDefaultRenewalModeColumn) {
    defaultSelections.push('dbs.default_renewal_mode as tenant_default_renewal_mode');
  }
  if (hasDefaultNoticePeriodColumn) {
    defaultSelections.push('dbs.default_notice_period_days as tenant_default_notice_period_days');
  }

  let contractQuery = knex('client_contracts as cc')
    .join('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .where({
      'cc.tenant': tenantId,
      'cc.is_active': true,
      'c.status': 'active',
    })
    .select(['cc.*', 'c.status as contract_status', ...defaultSelections]);

  if (defaultSelections.length > 0) {
    contractQuery = contractQuery.leftJoin('default_billing_settings as dbs', function joinDefaultBillingSettings() {
      this.on('cc.tenant', '=', 'dbs.tenant');
    });
  }

  const candidateRows = await contractQuery;
  let eligibleRows = 0;
  let upsertedCount = 0;
  let normalizedStatusCount = 0;
  let newCycleCount = 0;
  const nowIso = new Date().toISOString();

  for (const row of candidateRows) {
    const normalized = normalizeClientContract(row as any) as unknown as Record<string, unknown>;
    const decisionDueDate = normalizeOptionalDateOnly(normalized.decision_due_date);
    if (!decisionDueDate || decisionDueDate < today || decisionDueDate > horizonDate) {
      continue;
    }
    eligibleRows += 1;

    const currentStatus = (row as any).status;
    const previousCycleKey =
      hasRenewalCycleKeyColumn && typeof (row as any).renewal_cycle_key === 'string'
        ? ((row as any).renewal_cycle_key as string)
        : null;
    const nextCycleKey =
      hasRenewalCycleKeyColumn && typeof normalized.renewal_cycle_key === 'string'
        ? (normalized.renewal_cycle_key as string)
        : null;
    const cycleChanged =
      hasRenewalCycleKeyColumn &&
      typeof nextCycleKey === 'string' &&
      nextCycleKey.length > 0 &&
      previousCycleKey !== nextCycleKey;

    const shouldNormalizeStatus = !isKnownRenewalStatus(currentStatus) || cycleChanged;
    const updates: Record<string, unknown> = {};

    if ((row as any).decision_due_date !== decisionDueDate) {
      updates.decision_due_date = decisionDueDate;
    }
    if (hasRenewalCycleStartColumn) {
      const nextCycleStart = normalizeOptionalDateOnly(normalized.renewal_cycle_start);
      const previousCycleStart = normalizeOptionalDateOnly((row as any).renewal_cycle_start);
      if (nextCycleStart !== previousCycleStart) {
        updates.renewal_cycle_start = nextCycleStart;
      }
    }
    if (hasRenewalCycleEndColumn) {
      const nextCycleEnd = normalizeOptionalDateOnly(normalized.renewal_cycle_end);
      const previousCycleEnd = normalizeOptionalDateOnly((row as any).renewal_cycle_end);
      if (nextCycleEnd !== previousCycleEnd) {
        updates.renewal_cycle_end = nextCycleEnd;
      }
    }
    if (hasRenewalCycleKeyColumn && nextCycleKey !== previousCycleKey) {
      updates.renewal_cycle_key = nextCycleKey;
    }

    if (shouldNormalizeStatus) {
      updates.status = 'pending';
      if (hasSnoozedUntilColumn) {
        updates.snoozed_until = null;
      }
      if (!isKnownRenewalStatus(currentStatus) || currentStatus !== 'pending') {
        normalizedStatusCount += 1;
      }
    }

    if (cycleChanged) {
      if (hasCreatedTicketIdColumn) {
        updates.created_ticket_id = null;
      }
      if (hasCreatedDraftContractIdColumn) {
        updates.created_draft_contract_id = null;
      }
      newCycleCount += 1;
    }

    if (Object.keys(updates).length === 0) {
      continue;
    }

    await knex('client_contracts')
      .where({
        tenant: tenantId,
        client_contract_id: (row as any).client_contract_id,
      })
      .update({
        ...updates,
        updated_at: nowIso,
      });
    upsertedCount += 1;
  }

  logger.info('Renewal queue processing completed', {
    tenantId,
    horizonDays,
    scannedRows: candidateRows.length,
    eligibleRows,
    upsertedCount,
    normalizedStatusCount,
    newCycleCount,
  });
}
