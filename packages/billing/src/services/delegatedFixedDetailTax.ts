import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Fixed-plan charges carry their tax on two levels: one serviceless parent row in
 * `invoice_charges` and one `invoice_charge_fixed_details` row per plan service.
 * Accounting export expansion (accountingExportChargeExpansion.ts) requires the
 * detail tax to sum to the parent tax exactly, so whenever tax is delegated to an
 * external system the detail rows must follow the parent instead of keeping the
 * engine's computed tax.
 */

type FixedDetailRow = {
  item_detail_id: string;
  allocated_amount: unknown;
  parent_item_id: string;
  parent_net_amount: unknown;
  parent_tax_amount: unknown;
};

/**
 * Split `totalCents` across `weights` in integer cents: floor per row, with the
 * remainder parked on the last positive-weight row so the parts sum to the total
 * exactly. Non-positive weights get 0. When no weight is positive the whole
 * amount lands on the final row, because an exact sum matters more than the
 * (meaningless) proportion.
 */
export function allocateCentsByWeight(totalCents: number, weights: ReadonlyArray<number>): number[] {
  const result = weights.map(() => 0);
  if (!result.length) return result;

  const total = Math.round(Number(totalCents) || 0);
  const positive = weights.map((weight) => {
    const value = Number(weight);
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
  const weightSum = positive.reduce((sum, weight) => sum + weight, 0);

  if (weightSum <= 0) {
    result[result.length - 1] = total;
    return result;
  }

  let lastPositive = 0;
  for (let index = 0; index < positive.length; index += 1) {
    if (positive[index] > 0) lastPositive = index;
  }

  let assigned = 0;
  for (let index = 0; index < positive.length; index += 1) {
    if (index === lastPositive || positive[index] === 0) continue;
    const share = Math.floor((positive[index] / weightSum) * total);
    result[index] = share;
    assigned += share;
  }
  result[lastPositive] = total - assigned;
  return result;
}

/** Fixed-plan allocation rows for one invoice, with their parent charge amounts. */
async function loadFixedDetailRows(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string
): Promise<FixedDetailRow[]> {
  const db = tenantDb(conn, tenant);
  const query = db.table('invoice_charge_details as iid')
    .where('ic.invoice_id', invoiceId)
    .orderBy('iifd.item_detail_id')
    .select(
      'iifd.item_detail_id',
      'iifd.allocated_amount',
      'iid.item_id as parent_item_id',
      'ic.net_amount as parent_net_amount',
      'ic.tax_amount as parent_tax_amount'
    );
  db.tenantJoin(query, 'invoice_charge_fixed_details as iifd', 'iifd.item_detail_id', 'iid.item_detail_id');
  db.tenantJoin(query, 'invoice_charges as ic', 'ic.item_id', 'iid.item_id');
  return (await query) as unknown as FixedDetailRow[];
}

/**
 * Zero the tax on every fixed-plan allocation row of an invoice whose tax is
 * pending an external import: the parent reads 0, so the details must too.
 * Returns the number of detail rows considered.
 */
export async function zeroFixedDetailTaxForInvoice(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string
): Promise<number> {
  const rows = await loadFixedDetailRows(conn, tenant, invoiceId);
  if (!rows.length) return 0;

  await tenantDb(conn, tenant).table('invoice_charge_fixed_details')
    .whereIn('item_detail_id', rows.map((row) => row.item_detail_id))
    .update({ tax_amount: 0, tax_rate: 0 });
  return rows.length;
}

/**
 * Push each fixed-plan parent's (externally authoritative) tax down onto its
 * allocation rows, proportional to `allocated_amount`, so
 * `sum(detail.tax_amount) === parent.tax_amount` holds exactly. Each detail's
 * `tax_rate` becomes the parent's effective rate (tax / net * 100): the engine's
 * per-service rate is stale once the external system owns the tax, and the
 * parent's blended rate is the only rate the imported amount supports.
 * Returns the number of detail rows updated.
 */
export async function distributeExternalTaxToFixedDetails(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string
): Promise<number> {
  const rows = await loadFixedDetailRows(conn, tenant, invoiceId);
  if (!rows.length) return 0;

  const byParent = new Map<string, FixedDetailRow[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.parent_item_id) ?? [];
    siblings.push(row);
    byParent.set(row.parent_item_id, siblings);
  }

  const db = tenantDb(conn, tenant);
  let updated = 0;
  for (const details of byParent.values()) {
    const parentTax = Math.round(Number(details[0].parent_tax_amount ?? 0));
    const parentNet = Number(details[0].parent_net_amount ?? 0);
    const taxRate = parentNet ? Number(((parentTax / parentNet) * 100).toFixed(6)) : 0;
    const shares = allocateCentsByWeight(parentTax, details.map((row) => Number(row.allocated_amount ?? 0)));

    for (let index = 0; index < details.length; index += 1) {
      await db.table('invoice_charge_fixed_details')
        .where('item_detail_id', details[index].item_detail_id)
        .update({ tax_amount: shares[index], tax_rate: taxRate });
      updated += 1;
    }
  }
  return updated;
}
