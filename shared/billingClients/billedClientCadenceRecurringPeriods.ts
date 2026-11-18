import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type BilledClientCadenceRecurringPeriodRow = {
  contract_id: string;
  service_period_start: unknown;
  service_period_end: unknown;
  invoice_window_start: unknown;
  invoice_window_end: unknown;
};

/**
 * The single definition of "billed" client-cadence ledger rows: the
 * `recurring_service_periods` rows of a client's own contracts that are either
 * `lifecycle_state='billed'` or linked to an invoice charge detail (including
 * drafts). Superseded/archived rows and regenerated future rows that are
 * neither billed nor invoice-linked are excluded. Raw DB values are returned;
 * callers normalize dates.
 */
export async function loadBilledClientCadenceRecurringPeriods(
  trx: Knex | Knex.Transaction,
  params: { tenant: string; clientId: string },
): Promise<BilledClientCadenceRecurringPeriodRow[]> {
  const db = tenantDb(trx, params.tenant);
  const query = db.table('recurring_service_periods as rsp');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'rsp.obligation_id');
  db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');
  return (await query
    .where('rsp.cadence_owner', 'client')
    .where('ct.owner_client_id', params.clientId)
    .where((builder) => {
      builder.where('rsp.lifecycle_state', 'billed')
        .orWhereNotNull('rsp.invoice_charge_detail_id');
    })
    .select({
      contract_id: 'cl.contract_id',
      service_period_start: 'rsp.service_period_start',
      service_period_end: 'rsp.service_period_end',
      invoice_window_start: 'rsp.invoice_window_start',
      invoice_window_end: 'rsp.invoice_window_end',
    })) as BilledClientCadenceRecurringPeriodRow[];
}
