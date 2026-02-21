import { createTenantKnex } from 'server/src/lib/db';
import logger from '@alga-psa/core/logger';

export interface RenewalQueueProcessorJobData extends Record<string, unknown> {
  tenantId: string;
  horizonDays?: number;
}

const DEFAULT_RENEWAL_PROCESSING_HORIZON_DAYS = 90;
const toDateOnly = (value: Date): string => value.toISOString().slice(0, 10);
const addDays = (base: Date, days: number): Date => {
  const shifted = new Date(base);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
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
  const [hasDecisionDueDateColumn, hasStatusColumn] = await Promise.all([
    schema?.hasColumn?.('client_contracts', 'decision_due_date') ?? false,
    schema?.hasColumn?.('client_contracts', 'status') ?? false,
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

  const dueRows = await knex('client_contracts as cc')
    .join('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .where({
      'cc.tenant': tenantId,
      'cc.is_active': true,
      'c.status': 'active',
    })
    .whereNotNull('cc.decision_due_date')
    .andWhere('cc.decision_due_date', '>=', today)
    .andWhere('cc.decision_due_date', '<=', horizonDate)
    .select('cc.client_contract_id', 'cc.status');

  let normalizedCount = 0;
  const nowIso = new Date().toISOString();

  for (const row of dueRows) {
    const status = typeof (row as any).status === 'string' ? (row as any).status : null;
    const isKnownStatus =
      status === 'pending' ||
      status === 'renewing' ||
      status === 'non_renewing' ||
      status === 'snoozed' ||
      status === 'completed';

    if (isKnownStatus) {
      continue;
    }

    await knex('client_contracts')
      .where({
        tenant: tenantId,
        client_contract_id: (row as any).client_contract_id,
      })
      .update({
        status: 'pending',
        updated_at: nowIso,
      });
    normalizedCount += 1;
  }

  logger.info('Renewal queue processing completed', {
    tenantId,
    horizonDays,
    scannedRows: dueRows.length,
    normalizedCount,
  });
}
