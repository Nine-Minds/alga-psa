import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IBillingPeriod } from '@alga-psa/types';
import {
  filterApplicableDiscounts,
  buildDiscountEvaluationWindowsByContractLine,
  type DiscountComputeCandidate,
  type DiscountEvaluationCharge,
} from './compute/computeDiscountsAndAdjustments';

/** Shared policy selection for preview and persisted invoice recalculation. */
export async function resolveInvoiceDiscounts(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  period: IBillingPeriod,
  charges: DiscountEvaluationCharge[],
) {
  const windows = [...buildDiscountEvaluationWindowsByContractLine(charges).values()].flat();
  const start = [period.startDate, ...windows.map(window => window.start)].sort()[0];
  const end = [period.endDate, ...windows.map(window => window.endInclusive)].sort().at(-1)!;
  const rows = await tenantDb(conn, tenant).table('discounts')
    .join('contract_line_discounts as ld', function () {
      this.on('discounts.discount_id', '=', 'ld.discount_id').andOn('discounts.tenant', '=', 'ld.tenant');
    })
    .join('contract_lines as l', function () {
      this.on('ld.contract_line_id', '=', 'l.contract_line_id').andOn('ld.tenant', '=', 'l.tenant');
    })
    .join('client_contracts as cc', function () {
      this.on('cc.contract_id', '=', 'l.contract_id').andOn('cc.tenant', '=', 'l.tenant');
    })
    .where({ 'cc.client_id': clientId, 'discounts.is_active': true })
    .andWhere('discounts.start_date', '<=', end)
    .andWhere(function () {
      this.whereNull('discounts.end_date').orWhere('discounts.end_date', '>', start);
    })
    .select('discounts.*', 'ld.contract_line_id') as DiscountComputeCandidate[];
  // Charge coverage may precede the invoice window (arrears/carry-forward).
  // Query bounds include both invoice and covered service periods.
  return filterApplicableDiscounts(rows.sort((a, b) => a.discount_id.localeCompare(b.discount_id)), period, charges);
}
