/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('service_catalog', (table) => {
    // Add the nullable tax_rate_id column (UUID type)
    table.uuid('tax_rate_id').nullable();

    // Add the foreign key constraint referencing tax_rates(tax_rate_id)
    // Using ON DELETE SET NULL: If a tax rate is deleted, associated services will have tax_rate_id set to NULL.
    table.foreign('tax_rate_id', 'service_catalog_tax_rate_id_fkey')
         .references('tax_rate_id')
         .inTable('tax_rates')
         .onDelete('SET NULL');
  });

  // Optional: Add an index for potential performance improvements.
  // Consider adding this in a separate migration if needed after analyzing query patterns.
  // await knex.schema.alterTable('service_catalog', (table) => {
  //   table.index(['tenant', 'tax_rate_id'], 'idx_service_catalog_tenant_tax_rate_id');
  // });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('service_catalog', (table) => {
    // Drop the foreign key constraint first
    table.dropForeign('tax_rate_id', 'service_catalog_tax_rate_id_fkey');

    // Drop the index if it was added
    // table.dropIndex(['tenant', 'tax_rate_id'], 'idx_service_catalog_tenant_tax_rate_id');

    // Drop the column
    table.dropColumn('tax_rate_id');
  });
};
