/**
 * Add an optional per-rate tax cap.
 *
 * `cap_amount` is the maximum tax a single rate may charge for one
 * calculation, expressed in the smallest currency unit (the same unit as the
 * invoice line net amount). It is nullable so every existing rate keeps its
 * current uncapped behaviour; a stored 0 is a real cap that charges no tax.
 * A non-negative check constraint rejects negative caps at the database
 * boundary (the service validates them too).
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('tax_rates', 'cap_amount');
  if (!hasColumn) {
    await knex.schema.alterTable('tax_rates', function(table) {
      table.bigInteger('cap_amount').nullable()
        .comment('Maximum tax this rate may charge per calculation, in the smallest currency unit. Null means uncapped.');
    });
  }

  const constraint = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'tax_rates_cap_amount_check'
        AND conrelid = 'tax_rates'::regclass
    ) AS present`,
  );
  if (!constraint.rows?.[0]?.present) {
    await knex.raw(
      'ALTER TABLE tax_rates ADD CONSTRAINT tax_rates_cap_amount_check CHECK (cap_amount >= 0)',
    );
  }
};

exports.down = async function(knex) {
  await knex.raw('ALTER TABLE tax_rates DROP CONSTRAINT IF EXISTS tax_rates_cap_amount_check');
  const hasColumn = await knex.schema.hasColumn('tax_rates', 'cap_amount');
  if (hasColumn) {
    await knex.schema.alterTable('tax_rates', function(table) {
      table.dropColumn('cap_amount');
    });
  }
};

// ALTER TABLE on Citus-distributed tables must not run inside a transaction.
exports.config = { transaction: false };
