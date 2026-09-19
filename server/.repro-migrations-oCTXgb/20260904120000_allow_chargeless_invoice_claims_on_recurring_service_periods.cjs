const TABLE = 'recurring_service_periods';
const ALL_OR_NOTHING_CONSTRAINT = `${TABLE}_invoice_linkage_check`;

/**
 * Allow a recurring service period to be claimed by an invoice WITHOUT a
 * backing charge detail row.
 *
 * Charge persistence links a period only when a charge references it. A
 * grouped window whose lines produce no charges (zero-dollar usage/bucket
 * periods with no activity in the month) still belongs to the invoice that
 * closed the window: leaving those rows unlinked made them invisible to the
 * duplicate detector, so the same window could be invoiced twice while the
 * periods stayed listed as due. Generation now sweeps them —
 * `lifecycle_state='billed'` with `invoice_id` + `invoice_linked_at` set and
 * the charge/detail columns honestly NULL — which the previous all-or-nothing
 * constraint forbade.
 *
 * The invariants that remain enforced:
 * - `invoice_id` and `invoice_linked_at` are set together or not at all;
 * - `invoice_charge_id` and `invoice_charge_detail_id` are set together or
 *   not at all, and only on rows that carry an invoice claim.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) {
    return;
  }

  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${ALL_OR_NOTHING_CONSTRAINT}`);
  await knex.raw(`
    ALTER TABLE ${TABLE}
    ADD CONSTRAINT ${ALL_OR_NOTHING_CONSTRAINT}
    CHECK (
      (
        invoice_id IS NULL
        AND invoice_charge_id IS NULL
        AND invoice_charge_detail_id IS NULL
        AND invoice_linked_at IS NULL
      )
      OR (
        invoice_id IS NOT NULL
        AND invoice_linked_at IS NOT NULL
        AND (
          (invoice_charge_id IS NOT NULL AND invoice_charge_detail_id IS NOT NULL)
          OR (invoice_charge_id IS NULL AND invoice_charge_detail_id IS NULL)
        )
      )
    )
  `);
};

/**
 * Restores the strict all-or-nothing linkage constraint. Charge-less claims
 * are released first (back to unlinked `generated`) — the tightened
 * constraint forbids them, and an unlinked period is re-claimable, which is
 * the pre-migration behavior.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) {
    return;
  }

  await knex(TABLE)
    .whereNotNull('invoice_id')
    .whereNull('invoice_charge_detail_id')
    .update({
      lifecycle_state: 'generated',
      invoice_id: null,
      invoice_charge_id: null,
      invoice_linked_at: null,
    });

  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${ALL_OR_NOTHING_CONSTRAINT}`);
  await knex.raw(`
    ALTER TABLE ${TABLE}
    ADD CONSTRAINT ${ALL_OR_NOTHING_CONSTRAINT}
    CHECK (
      (
        invoice_id IS NULL
        AND invoice_charge_id IS NULL
        AND invoice_charge_detail_id IS NULL
        AND invoice_linked_at IS NULL
      )
      OR (
        invoice_id IS NOT NULL
        AND invoice_charge_id IS NOT NULL
        AND invoice_charge_detail_id IS NOT NULL
        AND invoice_linked_at IS NOT NULL
      )
    )
  `);
};
