/**
 * Per-seat (unit-priced) recurring services on contract templates.
 *
 * A contract line's Fixed service carries its pricing basis in
 * `contract_line_service_fixed_config` ('unit' = recurring quantity × unit
 * rate, 'bundle'/NULL = quantity only allocates a share of the line total).
 * Templates had no equivalent table, so a unit-priced service captured on a
 * template silently demoted to an allocation when the template was cloned into
 * a contract.
 *
 * This adds the template-side mirror. Rows exist only for unit-priced Fixed
 * services; every existing template service keeps no row and therefore stays a
 * bundle allocation. `base_rate` is the OPTIONAL default unit rate in minor
 * units — templates are currency-neutral, so NULL means "use the service's
 * catalog price in the contract's currency when the contract is created". The
 * default quantity lives in the existing
 * `contract_template_line_service_configuration.quantity`.
 *
 * Nothing here alters pricing_basis on existing data.
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('contract_template_line_service_fixed_config')) {
    return;
  }

  await knex.schema.createTable('contract_template_line_service_fixed_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.decimal('base_rate', 10, 2).nullable();
    table.text('pricing_basis').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()).notNullable();

    table.primary(['tenant', 'config_id']);
    table.foreign('tenant').references('tenants.tenant');
    table
      .foreign(['tenant', 'config_id'], 'contract_tpl_fixed_config_fk')
      .references(['tenant', 'config_id'])
      .inTable('contract_template_line_service_configuration')
      .onDelete('CASCADE');
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_service_fixed_config
    ADD CONSTRAINT contract_tpl_fixed_config_pricing_basis_check
    CHECK (pricing_basis IS NULL OR pricing_basis IN ('unit', 'bundle'))
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_template_line_service_fixed_config');
};
