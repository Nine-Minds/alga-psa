/**
 * Migration: Add bucket overlay fields to contract_line_preset_services
 *
 * This enables presets to store "recommended bucket" configurations similar to
 * how contract templates handle bucket overlays. When a preset is applied to a
 * contract line, these fields will be used to create the actual bucket configuration.
 */

exports.up = async function(knex) {
  // Add bucket overlay columns to contract_line_preset_services table
  await knex.schema.table('contract_line_preset_services', (table) => {
    table.integer('bucket_total_minutes'); // Total hours/units in the bucket (in minutes)
    table.bigInteger('bucket_overage_rate'); // Rate per unit for overage (in cents)
    table.boolean('bucket_allow_rollover'); // Whether unused bucket rolls over to next period
  });

  console.log('Added bucket overlay columns to contract_line_preset_services');
};

exports.down = async function(knex) {
  // Remove bucket overlay columns from contract_line_preset_services table
  await knex.schema.table('contract_line_preset_services', (table) => {
    table.dropColumn('bucket_total_minutes');
    table.dropColumn('bucket_overage_rate');
    table.dropColumn('bucket_allow_rollover');
  });

  console.log('Removed bucket overlay columns from contract_line_preset_services');
};
