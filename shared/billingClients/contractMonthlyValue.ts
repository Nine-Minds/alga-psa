import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface ContractMonthlyValue {
  clientContractId: string;
  /**
   * Fixed recurring value only, in minor currency units. Usage lines bill
   * recorded usage and contribute variable revenue that cannot be stated as a
   * fixed monthly amount, so they are excluded here and flagged via
   * {@link ContractMonthlyValue.hasVariableUsage} instead of silently
   * reporting zero.
   */
  monthlyValueCents: number;
  currencyCode: string;
  /** True when the contract has usage-billed lines with variable, record-driven revenue. */
  hasVariableUsage: boolean;
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
    // Usage lines are record-driven variable revenue: any custom_rate on them
    // is not a recurring monthly amount, so it is excluded rather than summed.
    .sum({ monthly_value_cents: conn.raw("CASE WHEN cln.contract_line_type = 'Usage' THEN 0 ELSE COALESCE(cln.custom_rate, 0) END") })
    .max({ usage_line_flag: conn.raw("CASE WHEN cln.contract_line_type = 'Usage' THEN 1 ELSE 0 END") }) as Array<{
      client_contract_id: string;
      currency_code: string;
      monthly_value_cents: string | number | null;
      usage_line_flag: string | number | null;
    }>;

  return new Map(rows.map((row) => [
    row.client_contract_id,
    {
      clientContractId: row.client_contract_id,
      monthlyValueCents: Number(row.monthly_value_cents ?? 0) || 0,
      currencyCode: row.currency_code,
      hasVariableUsage: Number(row.usage_line_flag ?? 0) === 1,
    },
  ]));
}
