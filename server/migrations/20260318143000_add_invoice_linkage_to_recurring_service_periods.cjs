const TABLE = 'recurring_service_periods';
const ALL_OR_NOTHING_CONSTRAINT = `${TABLE}_invoice_linkage_check`;
const STATE_CONSTRAINT = `${TABLE}_invoice_linkage_state_check`;
const DETAIL_UNIQUE_INDEX = `${TABLE}_tenant_invoice_charge_detail_uidx`;
const INVOICE_INDEX = `${TABLE}_tenant_invoice_linkage_idx`;

/**
 * Add additive invoice-linkage columns to the persisted recurring service-period
 * ledger so later billing passes can trace one billed service-period record back
 * to the canonical invoice detail row that consumed it.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) {
    return;
  }

  await knex.schema.alterTable(TABLE, (table) => {
    table.uuid('invoice_id').nullable();
    table.uuid('invoice_charge_id').nullable();
    table.uuid('invoice_charge_detail_id').nullable();
    table.timestamp('invoice_linked_at', { useTz: true }).nullable();
    table.unique(['tenant', 'invoice_charge_detail_id'], DETAIL_UNIQUE_INDEX);
    table.index(['tenant', 'invoice_id'], INVOICE_INDEX);
  });

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

  await knex.raw(`
    ALTER TABLE ${TABLE}
    ADD CONSTRAINT ${STATE_CONSTRAINT}
    CHECK (invoice_charge_detail_id IS NULL OR lifecycle_state = 'billed')
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) {
    return;
  }

  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${ALL_OR_NOTHING_CONSTRAINT}`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${STATE_CONSTRAINT}`);

  await knex.schema.alterTable(TABLE, (table) => {
    table.dropUnique(['tenant', 'invoice_charge_detail_id'], DETAIL_UNIQUE_INDEX);
    table.dropIndex(['tenant', 'invoice_id'], INVOICE_INDEX);
    table.dropColumn('invoice_linked_at');
    table.dropColumn('invoice_charge_detail_id');
    table.dropColumn('invoice_charge_id');
    table.dropColumn('invoice_id');
  });
};
