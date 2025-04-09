'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Step 1: Add the new column, but keep the old one for data migration
  await knex.schema.alterTable('companies', (table) => {
    table.string('region_code', 255).nullable();
  });

  // Add the composite foreign key constraint using raw SQL
  // References tax_regions(tenant, region_code)
  // ON DELETE SET NULL because region_code is nullable in companies
  await knex.raw(`
    ALTER TABLE companies
    ADD CONSTRAINT companies_tenant_region_code_fkey
    FOREIGN KEY (tenant, region_code)
    REFERENCES tax_regions (tenant, region_code)
    ON DELETE SET NULL;
  `);

  // Step 2: Populate the new region_code column using the old tax_region
  // Assumes tax_regions table is populated by the preceding migration.
  await knex.raw(`
    UPDATE companies c
    SET region_code = tr.region_code
    FROM tax_regions tr
    WHERE c.tenant = tr.tenant
      AND c.tax_region = tr.region_name
      AND c.region_code IS NULL;
  `);

  // Step 3: Add index and drop the old column now that data is migrated
  await knex.schema.alterTable('companies', (table) => {
    // Add an index on the new column (including tenant) for performance
    table.index(['tenant', 'region_code'], 'idx_companies_tenant_region_code');
    // Drop the old tax_region column
    table.dropColumn('tax_region');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop the foreign key constraint first
  await knex.raw(`
    ALTER TABLE companies
    DROP CONSTRAINT IF EXISTS companies_tenant_region_code_fkey;
  `);

  // Step 1 for Down: Add back old column, drop index
  await knex.schema.alterTable('companies', (table) => {
    // Add the old 'tax_region' column back
    table.string('tax_region', 255).nullable();
    // Drop the index
    table.dropIndex(['tenant', 'region_code'], 'idx_companies_tenant_region_code');
  });

  // Step 2 for Down: Populate old column from new column before dropping it
  await knex.raw(`
    UPDATE companies c
    SET tax_region = tr.region_name
    FROM tax_regions tr
    WHERE c.tenant = tr.tenant
      AND c.region_code = tr.region_code
      AND c.tax_region IS NULL;
  `);

  // Step 3 for Down: Drop the new column
  await knex.schema.alterTable('companies', (table) => {
    table.dropColumn('region_code');
  });
};