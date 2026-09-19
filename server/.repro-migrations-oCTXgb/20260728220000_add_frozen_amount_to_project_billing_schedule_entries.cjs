/**
 * Freeze approved project billing schedule amounts so later total edits do not
 * rewrite already-approved or invoiced dollars.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('project_billing_schedule_entries', (table) => {
    table.bigInteger('frozen_amount').nullable();
  });

  // Citus rejects distributed-table UPDATE expressions that read another
  // column (including casts/functions). Select tenant-scoped source values
  // first, then write parameterized literals back to each tenant's shard.
  const invoicedEntries = await knex('project_billing_schedule_entries as entry')
    .innerJoin('invoice_charges as charge', function joinInvoiceCharge() {
      this.on('entry.tenant', '=', 'charge.tenant')
        .andOn('entry.invoice_charge_id', '=', 'charge.item_id');
    })
    .where('entry.status', 'invoiced')
    .select(
      'entry.tenant',
      'entry.schedule_entry_id',
      'charge.net_amount',
    );

  for (const entry of invoicedEntries) {
    await knex('project_billing_schedule_entries')
      .where({
        tenant: entry.tenant,
        schedule_entry_id: entry.schedule_entry_id,
      })
      .update({ frozen_amount: entry.net_amount });
  }

  const approvedEntries = await knex('project_billing_schedule_entries as entry')
    .innerJoin('project_billing_configs as config', function joinBillingConfig() {
      this.on('entry.tenant', '=', 'config.tenant')
        .andOn('entry.config_id', '=', 'config.config_id');
    })
    .where('entry.status', 'approved')
    .select(
      'entry.tenant',
      'entry.schedule_entry_id',
      'entry.amount',
      'entry.percentage',
      'config.total_price',
    );

  for (const entry of approvedEntries) {
    const frozenAmount = approvedFrozenAmount(entry);
    await knex('project_billing_schedule_entries')
      .where({
        tenant: entry.tenant,
        schedule_entry_id: entry.schedule_entry_id,
      })
      .update({ frozen_amount: frozenAmount });
  }

  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    ADD CONSTRAINT project_billing_schedule_entries_frozen_amount_check
    CHECK (
      (status IN ('approved', 'invoiced')) = (frozen_amount IS NOT NULL)
    ) NOT VALID
  `);
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    VALIDATE CONSTRAINT project_billing_schedule_entries_frozen_amount_check
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    DROP CONSTRAINT IF EXISTS project_billing_schedule_entries_frozen_amount_check
  `);
  await knex.schema.alterTable('project_billing_schedule_entries', (table) => {
    table.dropColumn('frozen_amount');
  });
};

const PERCENTAGE_SCALE = 10_000;
const FULL_PERCENTAGE_SCALED = 100 * PERCENTAGE_SCALE;

function approvedFrozenAmount(entry) {
  if (entry.amount !== null && entry.amount !== undefined) {
    return String(entry.amount);
  }
  if (
    entry.percentage === null
    || entry.percentage === undefined
    || entry.total_price === null
    || entry.total_price === undefined
  ) {
    throw new Error(
      `Cannot backfill approved project billing entry ${entry.schedule_entry_id}: `
      + 'percentage and total_price are required when amount is null',
    );
  }

  const percentage = Number(entry.percentage);
  if (!Number.isFinite(percentage) || percentage < 0) {
    throw new Error(
      `Cannot backfill approved project billing entry ${entry.schedule_entry_id}: `
      + `invalid percentage ${String(entry.percentage)}`,
    );
  }

  const scaledPercentage = BigInt(Math.round(percentage * PERCENTAGE_SCALE));
  const numerator = BigInt(String(entry.total_price)) * scaledPercentage;
  const denominator = BigInt(FULL_PERCENTAGE_SCALED);
  return String((numerator + denominator / 2n) / denominator);
}

exports.approvedFrozenAmount = approvedFrozenAmount;
