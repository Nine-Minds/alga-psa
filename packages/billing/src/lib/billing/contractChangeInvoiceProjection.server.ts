import type { Knex } from 'knex';
import type { InvoiceViewModel } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { applyContractChangeDescriptionSources } from './contractChangeInvoiceProjection';

/** Enrich current invoice output without rewriting settled charges or stored artifacts. */
export async function enrichContractChangeDescriptions(
  knex: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
  invoice: InvoiceViewModel,
): Promise<InvoiceViewModel> {
  const db = tenantDb(knex, tenant);
  if (!(await knex.schema.hasTable('contract_recurring_unit_adjustments'))) return invoice;
  const charges = invoice.invoice_charges ?? [];
  const sourceRows = await db.table('contract_recurring_unit_adjustments as a')
    .join('invoice_charges as c', function () {
      this.on('c.item_id', '=', 'a.settled_charge_id').andOn('c.tenant', '=', 'a.tenant');
    })
    .leftJoin('service_catalog as s', function () {
      this.on('s.service_id', '=', 'a.service_id').andOn('s.tenant', '=', 'a.tenant');
    })
    .where('c.invoice_id', invoiceId)
    .select('c.item_id', 's.service_name', 'a.service_id', 'a.adjustment_period_start', 'a.adjustment_period_end', 'a.mid_period_effective_date',
      'a.quantity_delta', 'a.unit_rate_cents', 'a.covered_days', 'a.full_period_days', 'a.amount_cents', 'a.currency_code');
  return {
    ...invoice,
    invoice_charges: applyContractChangeDescriptionSources(charges, sourceRows),
  };
}

