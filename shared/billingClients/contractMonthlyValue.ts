import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface ContractMonthlyValue {
  clientContractId: string;
  monthlyValueCents: number;
  currencyCode: string;
}

/**
 * Canonical contract monthly-value rollup used by renewal and expiration reporting.
 * Contract line custom_rate values are stored in minor currency units.
 */
export async function getContractMonthlyValuesByAssignment(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientContractIds?: string[],
): Promise<Map<string, ContractMonthlyValue>> {
  if (clientContractIds?.length === 0) return new Map();

  const db = tenantDb(conn, tenant);
  const query = db.table('client_contracts as cc');
  db.tenantJoin(query, 'contracts as c', 'cc.contract_id', 'c.contract_id');
  db.tenantJoin(query, 'contract_lines as cln', 'c.contract_id', 'cln.contract_id', { type: 'left' });
  if (clientContractIds) query.whereIn('cc.client_contract_id', clientContractIds);

  const rows = await query
    .groupBy('cc.client_contract_id', 'c.currency_code')
    .select('cc.client_contract_id', 'c.currency_code')
    .sum({ monthly_value_cents: conn.raw('COALESCE(cln.custom_rate, 0)') }) as Array<{
      client_contract_id: string;
      currency_code: string;
      monthly_value_cents: string | number | null;
    }>;

  return new Map(rows.map((row) => [
    row.client_contract_id,
    {
      clientContractId: row.client_contract_id,
      monthlyValueCents: Number(row.monthly_value_cents ?? 0) || 0,
      currencyCode: row.currency_code,
    },
  ]));
}
