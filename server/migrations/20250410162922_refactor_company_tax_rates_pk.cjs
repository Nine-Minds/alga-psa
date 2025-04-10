/**
 * Migration to refactor the primary key and add a unique constraint to the company_tax_rates table.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Step 1: Add the new UUID column
  await knex.schema.alterTable('company_tax_rates', (table) => {
    // Add the new UUID column, making it non-nullable.
    // Use the built-in gen_random_uuid() function for default values.
    table
      .uuid('company_tax_rates_id')
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));
  });

  // Note: If the table already contains data, existing rows will have NULL in the new column initially.
  // The default value only applies to new rows inserted after this change.
  // Populating existing rows might require a separate step or script if needed, e.g.:
  // await knex.raw(`UPDATE company_tax_rates SET company_tax_rates_id = uuid_generate_v4() WHERE company_tax_rates_id IS NULL`);
  // This is omitted here for simplicity, focusing on the schema structure change.

  // Step 2: Drop old PK, Add new PK and Unique Constraint
  await knex.schema.alterTable('company_tax_rates', (table) => {
    // Drop the existing composite primary key constraint.
    // IMPORTANT: The name 'company_tax_rates_pkey' is a common default but *must* be verified
    // against your actual database schema. Use \d company_tax_rates in psql to check.
    table.dropPrimary('company_tax_rates_pkey');

    // Add the new compound primary key constraint on 'company_tax_rates_id' and 'tenant'.
    // This is required for CitusDB compatibility.
    // Knex/PostgreSQL will likely name this constraint 'company_tax_rates_pkey' by default.
    table.primary(['company_tax_rates_id', 'tenant']);

    // Add the new unique constraint covering company_id, tax_rate_id, and tenant.
    // This enforces the business rule that a specific tax rate can only be associated
    // with a company once within a tenant.
    table.unique(
      ['company_id', 'tax_rate_id', 'tenant'],
      {
        indexName: 'company_tax_rates_comp_id_tax_rate_id_tenant_key', // Explicit index name
        constraintName: 'company_tax_rates_company_id_tax_rate_id_tenant_unique', // Explicit constraint name
      }
    );
  });
};

/**
 * Reverts the changes made in the up migration.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('company_tax_rates', (table) => {
    // Drop the unique constraint added in the 'up' migration.
    table.dropUnique(
      ['company_id', 'tax_rate_id', 'tenant'],
      'company_tax_rates_company_id_tax_rate_id_tenant_unique'
    );

    // Drop the primary key constraint from 'company_tax_rates_id'.
    // IMPORTANT: Verify the constraint name ('company_tax_rates_pkey' is assumed).
    table.dropPrimary('company_tax_rates_pkey');

    // Add back the original composite primary key constraint.
    // Knex/PostgreSQL will likely name this 'company_tax_rates_pkey' again.
    table.primary(['company_id', 'tax_rate_id']);
  });

  // Drop the 'company_tax_rates_id' column.
  await knex.schema.alterTable('company_tax_rates', (table) => {
    table.dropColumn('company_tax_rates_id');
  });
};
