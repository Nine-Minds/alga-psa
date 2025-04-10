/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('company_tax_rates', (table) => {
    // Add is_default column
    table
      .boolean('is_default')
      .notNullable()
      .defaultTo(false)
      .comment('Indicates if this is the default tax rate for the company');

    // Add location_id column (nullable)
    table
      .uuid('location_id')
      .nullable()
      .comment('Optional location this tax rate applies to');

    // Add foreign key constraint to company_locations
    table
      .foreign('location_id')
      .references('location_id')
      .inTable('company_locations')
      .onDelete('SET NULL'); // Or CASCADE/RESTRICT depending on desired behavior

    // Add index on location_id (including tenant for CitusDB)
    table.index(['tenant', 'location_id'], 'idx_company_tax_rates_tenant_location_id');
  });

  // Add unique constraint for only one default rate per company/tenant
  // Note: Partial unique indexes require raw SQL
  await knex.raw(`
    CREATE UNIQUE INDEX company_tax_rates_company_id_tenant_is_default_unique
    ON company_tax_rates (company_id, tenant, is_default)
    WHERE is_default = true;
  `);

  // NOTE: Dropping company_tax_settings.tax_rate_id is deferred to a later migration
  // after the data migration populates company_tax_rates.is_default.
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // NOTE: Re-adding company_tax_settings.tax_rate_id is handled in the down function
  // of the later migration that drops it.

  // Drop unique constraint on company_tax_rates
  await knex.raw(`
    DROP INDEX IF EXISTS company_tax_rates_company_id_tenant_is_default_unique;
  `);

  // Drop foreign key constraint for location_id using raw SQL *before* altering the table
  // Adjust constraint name 'company_tax_rates_location_id_fkey' if it's different in your DB.
  await knex.raw('ALTER TABLE company_tax_rates DROP CONSTRAINT IF EXISTS company_tax_rates_location_id_fkey;');

  // Reverse changes on company_tax_rates
  await knex.schema.alterTable('company_tax_rates', (table) => {
    // Drop index on location_id
    table.dropIndex(['tenant', 'location_id'], 'idx_company_tax_rates_tenant_location_id');

    // Drop location_id column (FK constraint already dropped above)
    table.dropColumn('location_id');

    // Drop is_default column
    table.dropColumn('is_default');
  });
};
