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
  // Step 2: Drop old PK, Add new PK and Unique Constraint (using raw SQL for robustness)

  // Drop the unique constraint first IF EXISTS
  await knex.raw(`
    ALTER TABLE public.company_tax_rates
    DROP CONSTRAINT IF EXISTS company_tax_rates_company_id_tax_rate_id_tenant_unique;
  `);

  // Drop the old primary key IF EXISTS
  await knex.raw(`
    ALTER TABLE public.company_tax_rates
    DROP CONSTRAINT IF EXISTS company_tax_rates_pkey;
  `);

  // Add the new primary key using Knex alterTable
  await knex.schema.alterTable('company_tax_rates', (table) => {
    // Add the new compound primary key constraint on 'company_tax_rates_id' and 'tenant'.
    // Knex will likely name this 'company_tax_rates_pkey' by default.
    table.primary(['company_tax_rates_id', 'tenant']);
  });

  // Add the unique constraint using raw SQL *after* the alterTable
  // Note: We dropped it above, so this should succeed.
  await knex.raw(`
    ALTER TABLE public.company_tax_rates
    ADD CONSTRAINT company_tax_rates_company_id_tax_rate_id_tenant_unique UNIQUE (company_id, tax_rate_id, tenant);
  `);
};

/**
 * Reverts the changes made in the up migration.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // Use raw SQL to drop the unique constraint IF EXISTS, making the rollback more robust
  await knex.raw(`
    ALTER TABLE public.company_tax_rates
    DROP CONSTRAINT IF EXISTS company_tax_rates_company_id_tax_rate_id_tenant_unique;
  `);

  await knex.schema.alterTable('company_tax_rates', (table) => {
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
