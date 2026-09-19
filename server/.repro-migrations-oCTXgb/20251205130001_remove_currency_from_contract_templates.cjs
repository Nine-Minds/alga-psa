/**
 * Migration: Remove currency_code from contract_templates
 *
 * This migration removes the currency_code column from contract_templates.
 * Contract templates become currency-neutral - they define structure (services,
 * billing frequency) but not currency.
 *
 * Currency flow after this change:
 * - Services have currency_code (rate is in that currency)
 * - Clients have default_currency_code
 * - Contracts inherit currency from the client they're assigned to
 * - Contract templates are currency-neutral blueprints
 *
 * The down migration restores the column with USD default for safety.
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Check if the column exists before attempting to drop
  const hasColumn = await knex.schema.hasColumn('contract_templates', 'currency_code');

  if (hasColumn) {
    await knex.schema.alterTable('contract_templates', (table) => {
      table.dropColumn('currency_code');
    });
    console.log('Removed currency_code column from contract_templates table');
  } else {
    console.log('currency_code column does not exist on contract_templates, skipping');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Check if the column already exists before attempting to add
  const hasColumn = await knex.schema.hasColumn('contract_templates', 'currency_code');

  if (!hasColumn) {
    await knex.schema.alterTable('contract_templates', (table) => {
      table.string('currency_code', 3).notNullable().defaultTo('USD');
    });
    console.log('Restored currency_code column to contract_templates table');
  } else {
    console.log('currency_code column already exists on contract_templates, skipping');
  }
};
