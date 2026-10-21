'use strict';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('discounts'))) return;
  await knex.raw('ALTER TABLE discounts DROP CONSTRAINT IF EXISTS discounts_scope_check');
  await knex.raw(`
    ALTER TABLE discounts
    ADD CONSTRAINT discounts_scope_check
    CHECK (scope IS NULL OR scope IN ('invoice', 'contract', 'line', 'service', 'item'))
  `);
  if (await knex.schema.hasTable('invoice_charges')
    && await knex.schema.hasColumn('invoice_charges', 'adjustment_scope')) {
    await knex.raw('ALTER TABLE invoice_charges DROP CONSTRAINT IF EXISTS invoice_charges_adjustment_scope_check');
    await knex.raw(`
      ALTER TABLE invoice_charges
      ADD CONSTRAINT invoice_charges_adjustment_scope_check
      CHECK (adjustment_scope IS NULL OR adjustment_scope IN ('invoice', 'contract', 'line', 'service', 'item'))
    `);
  }
};

exports.down = async function down(knex) {
  // Line-scoped definitions cannot safely be converted to another scope.
};
