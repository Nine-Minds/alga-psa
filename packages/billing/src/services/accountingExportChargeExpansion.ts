import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AccountingExportLine } from '@alga-psa/types';
import { applyContractChangeDescriptionSources } from '../lib/billing/contractChangeInvoiceProjection';

type Charge = {
  item_id: string; service_id?: string | null; is_manual?: boolean | null; is_discount?: boolean | null;
  net_amount?: number | string | null; tax_amount?: number | string | null; description?: string | null;
  adjustment_source_kind?: string | null;
};

/** Expand only canonical fixed-plan parents, using persisted allocations, never rates.
 * Export batch line identity stays the parent; detail identity identifies remote splits.
 * Ordinary generated/manual charges with missing services remain validation errors.
 */
export async function expandAccountingExportCharges<T extends Charge>(
  knex: Knex, tenant: string, charges: Map<string, T>, lines: AccountingExportLine[],
): Promise<{ charges: Map<string, T>; lines: AccountingExportLine[] }> {
  // A missing parent net amount is an accounting readiness error, not a value
  // to coerce to zero while checking allocation totals. Leave it unexpanded so
  // validation can report the more useful per-line missing-net-amount error.
  const db = tenantDb(knex, tenant);
  let expanded = new Map(charges);
  if (await knex.schema.hasTable('contract_recurring_unit_adjustments')) {
    const sourceIds = [...charges.values()]
      .filter((charge) => charge.adjustment_source_kind === 'contract_change')
      .map((charge) => charge.item_id);
    if (sourceIds.length) {
      const sourceQuery = db.table('invoice_charges as c');
      db.tenantJoin(sourceQuery, 'contract_recurring_unit_adjustments as a', 'a.settled_charge_id', 'c.item_id');
      db.tenantJoin(sourceQuery, 'service_catalog as s', 's.service_id', 'a.service_id', { type: 'left' });
      const sources = await sourceQuery.whereIn('c.item_id', sourceIds)
        .where('c.adjustment_source_kind', 'contract_change')
        .select('c.item_id', 's.service_name', 'a.service_id', 'a.currency_code',
          'a.adjustment_period_start', 'a.adjustment_period_end', 'a.mid_period_effective_date', 'a.quantity_delta',
          'a.unit_rate_cents', 'a.covered_days', 'a.full_period_days', 'a.amount_cents');
      const projected = applyContractChangeDescriptionSources([...expanded.values()], sources);
      expanded = new Map(projected.map((charge) => [charge.item_id, charge]));
    }
  }
  const parents = [...charges.values()].filter(row => row.is_manual === false && !row.service_id && !row.is_discount
    && row.net_amount !== null && row.net_amount !== undefined);
  if (!parents.length) return { charges: expanded, lines };
  const query = db.table('invoice_charge_details as d');
  db.tenantJoin(query, 'invoice_charge_fixed_details as f', 'd.item_detail_id', 'f.item_detail_id');
  const details = await query.whereIn('d.item_id', parents.map(row => row.item_id))
    .select('d.item_id', 'd.item_detail_id', 'd.service_id', 'f.allocated_amount', 'f.tax_amount');
  const result: AccountingExportLine[] = [];
  for (const line of lines) {
    const parent = charges.get(line.document_line_id ?? '');
    const children = parent && parents.includes(parent) ? details.filter(row => row.item_id === parent.item_id) : [];
    if (!parent || !children.length) { result.push(line); continue; }
    const net = children.reduce((sum, row) => sum + Number(row.allocated_amount), 0);
    const tax = children.reduce((sum, row) => sum + Number(row.tax_amount ?? 0), 0);
    if (net !== Number(parent.net_amount) || tax !== Number(parent.tax_amount ?? 0)) {
      throw new Error(`Fixed-plan allocation totals do not match charge ${parent.item_id}; repair the invoice before export.`);
    }
    for (const child of children) {
      const amount = Number(child.allocated_amount);
      const taxAmount = Number(child.tax_amount ?? 0);
      expanded.set(child.item_detail_id, { ...parent, item_id: child.item_detail_id,
        service_id: child.service_id, quantity: 1, unit_price: amount, net_amount: amount,
        tax_amount: taxAmount, total_price: amount + taxAmount,
      });
      result.push({
        ...line,
        document_line_id: child.item_detail_id,
        amount_cents: amount + taxAmount,
        payload: {
          ...line.payload,
          metadata: {
            ...line.payload?.metadata,
            allocation_parent_charge_id: parent.item_id,
            allocation_detail_id: child.item_detail_id,
          },
        },
      });
    }
  }
  return { charges: expanded, lines: result };
}
