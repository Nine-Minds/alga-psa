/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('service_catalog', (table) => {
    // Drop foreign key constraint first
    table.dropForeign(['tenant', 'region_code'], 'service_catalog_tenant_region_code_fkey');
    // Drop index (explicitly, though FK drop might handle it)
    table.dropIndex(['tenant', 'region_code'], 'idx_service_catalog_tenant_region_code');
    // Drop the columns
    table.dropColumn('region_code');
    table.dropColumn('is_taxable');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('service_catalog', (table) => {
    // Add columns back
    table.boolean('is_taxable').defaultTo(true);
    table.string('region_code', 255).nullable(); // Match original definition

    // Add index back
    table.index(['tenant', 'region_code'], 'idx_service_catalog_tenant_region_code');

    // Add foreign key constraint back
    table.foreign(['tenant', 'region_code'], 'service_catalog_tenant_region_code_fkey')
      .references(['tenant', 'region_code'])
      .inTable('tax_regions')
      .onDelete('SET NULL');
  });
};
