/**
 * Migration: add origin discriminator to accounting export batches so
 * scheduler-created auto-batches are distinguishable from operator batches.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('accounting_export_batches', 'origin');
  if (!hasColumn) {
    await knex.schema.alterTable('accounting_export_batches', (table) => {
      table.string('origin', 20).notNullable().defaultTo('manual'); // manual | scheduled
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('accounting_export_batches', 'origin');
  if (hasColumn) {
    await knex.schema.alterTable('accounting_export_batches', (table) => {
      table.dropColumn('origin');
    });
  }
};
