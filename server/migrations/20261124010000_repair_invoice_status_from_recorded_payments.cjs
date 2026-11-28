'use strict';

/**
 * One-time repair (alga-2026-0003329): finalize used to write status 'sent'
 * unconditionally, so an invoice unfinalized after payment came back from
 * finalize showing a balance the client had already paid. Finalize now derives
 * status from net recorded payments (deriveInvoiceStatus in
 * packages/billing/src/lib/balanceDue.ts); this recomputes the status of rows
 * already in the wrong state.
 *
 * Scope: finalized (finalized_at set) invoices currently 'sent', 'paid' or
 * 'partially_applied' that have at least one invoice_payments row, and whose
 * stored status disagrees with the derivation. Drafts, cancelled and void
 * invoices are never touched (drafts correct themselves when finalized).
 *
 * Derivation (mirrors deriveInvoiceStatus): net payments > 0 and
 * total - credit_applied - net payments <= 0 -> paid; net payments > 0 ->
 * partially_applied; otherwise sent. Overpayment stays 'paid'.
 *
 * Citus: the invoice_payments aggregate and the join are on (tenant, invoice_id),
 * so the UPDATE is colocated. The timestamp is bound from JS and applied as a
 * plain SET value: there is no now() inside CASE/COALESCE, and now() is not
 * evaluated per shard.
 */

exports.config = { transaction: false };

const UPDATE_SQL = `
  UPDATE invoices AS i
  SET status = d.derived_status,
      updated_at = ?::timestamptz
  FROM (
    SELECT inv.tenant,
           inv.invoice_id,
           CASE
             WHEN p.net_paid > 0
                  AND (inv.total_amount - COALESCE(inv.credit_applied, 0) - p.net_paid) <= 0 THEN 'paid'
             WHEN p.net_paid > 0 THEN 'partially_applied'
             ELSE 'sent'
           END AS derived_status
    FROM invoices AS inv
    JOIN (
      SELECT tenant, invoice_id, SUM(amount) AS net_paid
      FROM invoice_payments
      GROUP BY tenant, invoice_id
    ) AS p
      ON p.tenant = inv.tenant AND p.invoice_id = inv.invoice_id
    WHERE inv.finalized_at IS NOT NULL
      AND inv.status IN ('sent', 'paid', 'partially_applied')
  ) AS d
  WHERE i.tenant = d.tenant
    AND i.invoice_id = d.invoice_id
    AND i.status IS DISTINCT FROM d.derived_status
`;

async function repairInvoiceStatusFromRecordedPayments(knex, at = new Date()) {
  // migration-lint: allow 5 - one-shot repair; writes only finalized invoices whose stored status disagrees with their recorded payments (3 rows across 2 tenants in production on 2026-11-24), tenant-joined and colocated on Citus, so row locks are bounded by that mismatch set rather than table size
  const result = await knex.raw(UPDATE_SQL, [at.toISOString()]);
  return result.rowCount ?? 0;
}

exports.repairInvoiceStatusFromRecordedPayments = repairInvoiceStatusFromRecordedPayments;

exports.up = async function up(knex) {
  const hasPayments = await knex.schema.hasTable('invoice_payments');
  const hasInvoices = await knex.schema.hasTable('invoices');
  if (!hasPayments || !hasInvoices) return;
  const updated = await repairInvoiceStatusFromRecordedPayments(knex);
  console.log(`[repair_invoice_status_from_recorded_payments] corrected ${updated} invoice(s)`);
};

// Data repair: the previous (wrong) statuses are not recoverable and not worth restoring.
exports.down = async function down() {};
