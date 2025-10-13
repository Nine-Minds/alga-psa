/**
 * Rename contract_pricing_schedules.bundle_id -> contract_id
 *
 * Notes:
 * - Uses ALTER TABLE RENAME COLUMN for PostgreSQL so indexes/constraints remain intact.
 * - Down migration restores the original column name.
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('contract_pricing_schedules');
  if (!hasTable) return;

  const hasBundleId = await knex.schema.hasColumn('contract_pricing_schedules', 'bundle_id');
  const hasContractId = await knex.schema.hasColumn('contract_pricing_schedules', 'contract_id');

  if (hasBundleId && !hasContractId) {
    await knex.schema.alterTable('contract_pricing_schedules', (table) => {
      table.renameColumn('bundle_id', 'contract_id');
    });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('contract_pricing_schedules');
  if (!hasTable) return;

  const hasContractId = await knex.schema.hasColumn('contract_pricing_schedules', 'contract_id');
  const hasBundleId = await knex.schema.hasColumn('contract_pricing_schedules', 'bundle_id');

  if (hasContractId && !hasBundleId) {
    await knex.schema.alterTable('contract_pricing_schedules', (table) => {
      table.renameColumn('contract_id', 'bundle_id');
    });
  }
};

