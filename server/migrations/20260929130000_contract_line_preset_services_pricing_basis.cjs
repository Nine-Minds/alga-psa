/**
 * Per-seat (unit-priced) recurring services in contract line presets.
 *
 * A Fixed preset's services stored only a quantity (and, unused for Fixed, a
 * custom_rate), so a preset could not express "N seats at $X each" and every
 * line created from it came out as a bundle allocation.
 *
 * `pricing_basis` mirrors `contract_line_service_fixed_config.pricing_basis`:
 * 'unit' = recurring quantity x unit rate, NULL/'bundle' = the quantity only
 * allocates a share of the line total. For a 'unit' service `custom_rate` holds
 * the OPTIONAL default unit rate in minor units; presets are currency-neutral,
 * so NULL means "use the service's catalog price in the contract's currency
 * when a line is created from the preset".
 *
 * The column is nullable with no default and no backfill: every existing preset
 * service keeps NULL and therefore stays a bundle allocation. Nothing here
 * alters pricing_basis on existing data.
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('contract_line_preset_services'))) {
    return;
  }
  if (await knex.schema.hasColumn('contract_line_preset_services', 'pricing_basis')) {
    return;
  }

  await knex.schema.alterTable('contract_line_preset_services', (table) => {
    table.text('pricing_basis').nullable();
  });

  await knex.raw(`
    ALTER TABLE contract_line_preset_services
    ADD CONSTRAINT contract_line_preset_services_pricing_basis_check
    CHECK (pricing_basis IS NULL OR pricing_basis IN ('unit', 'bundle'))
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('contract_line_preset_services'))) {
    return;
  }
  await knex.raw(
    'ALTER TABLE contract_line_preset_services DROP CONSTRAINT IF EXISTS contract_line_preset_services_pricing_basis_check',
  );
  if (await knex.schema.hasColumn('contract_line_preset_services', 'pricing_basis')) {
    await knex.schema.alterTable('contract_line_preset_services', (table) => {
      table.dropColumn('pricing_basis');
    });
  }
};
