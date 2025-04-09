'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('tax_rates', (table) => {
    // Add the new region_code column, initially nullable for data migration phase
    table.string('region_code', 255).nullable();

    // Drop the old unique constraint involving 'region'
    // Constraint name from schema inspection: tax_rates_tenant_region_start_date_end_date_unique
    table.dropUnique(['tenant', 'region', 'start_date', 'end_date'], 'tax_rates_tenant_region_start_date_end_date_unique');
  });

  // Add the composite foreign key constraint using raw SQL for clarity with composite keys
  // This links (tenant, region_code) in tax_rates to (tenant, region_code) in tax_regions
  await knex.raw(`
    ALTER TABLE tax_rates
    ADD CONSTRAINT tax_rates_tenant_region_code_fkey
    FOREIGN KEY (tenant, region_code)
    REFERENCES tax_regions (tenant, region_code)
    ON DELETE RESTRICT; -- Using RESTRICT as a safe default
  `);

  // --- Data Migration: Populate region_code from region ---
  // Update region_code based on the mapping in tax_regions using region_name.
  // This assumes tax_regions is populated and contains matching region_names.
  await knex.raw(`
    UPDATE tax_rates tr
    SET region_code = treg.region_code
    FROM tax_regions treg
    WHERE tr.tenant = treg.tenant
      AND tr.region = treg.region_name
      AND tr.region_code IS NULL;
  `);
  // If any region_code is still NULL here, the next step (NOT NULL constraint)
  // will fail, indicating missing data in tax_regions or inconsistent names.
  // ------------------------------------------------------

  // Now make region_code non-nullable and drop the old column
  await knex.schema.alterTable('tax_rates', (table) => {
    // Alter column to be non-nullable AFTER potential data migration
    table.string('region_code', 255).notNullable().alter();

    // Drop the old region column
    table.dropColumn('region');

    // REMOVED: Unique constraint on ['tenant', 'region_code', 'start_date', 'end_date'].
    // This constraint was removed to allow multiple tax rates (composite taxes)
    // to exist for the same region and overlapping date ranges.
    // The primary key (tax_rate_id) ensures row uniqueness.
    // Business logic will handle aggregation of rates.
    // table.unique(['tenant', 'region_code', 'start_date', 'end_date'], { indexName: 'tax_rates_tenant_region_code_dates_key' });

    // Add an index specifically on the foreign key columns for query performance
    table.index(['tenant', 'region_code'], 'idx_tax_rates_tenant_region_code');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('tax_rates', (table) => {
    // REMOVED: Corresponding dropUnique for the removed constraint above.
    // table.dropUnique(['tenant', 'region_code', 'start_date', 'end_date'], 'tax_rates_tenant_region_code_dates_key');

    // Drop the index
    table.dropIndex(['tenant', 'region_code'], 'idx_tax_rates_tenant_region_code');

    // Add the old 'region' column back (nullable initially)
    table.string('region', 255).nullable(); // Max length from original schema
  });

    // Drop the foreign key constraint using raw SQL
  await knex.raw(`
    ALTER TABLE tax_rates
    DROP CONSTRAINT IF EXISTS tax_rates_tenant_region_code_fkey;
  `);

  // --- Data Rollback: Populate region from region_code ---
  // Update the old 'region' column based on the mapping in tax_regions.
  await knex.raw(`
    UPDATE tax_rates tr
    SET region = treg.region_name
    FROM tax_regions treg
    WHERE tr.tenant = treg.tenant
      AND tr.region_code = treg.region_code
      AND tr.region IS NULL;
  `);
  // -----------------------------------------------------

  await knex.schema.alterTable('tax_rates', (table) => {
    // Drop the 'region_code' column
    table.dropColumn('region_code');

    // Re-add the old unique constraint
    // Original schema showed 'region' as nullable, so we don't make it non-nullable here.
    table.unique(['tenant', 'region', 'start_date', 'end_date'], { indexName: 'tax_rates_tenant_region_start_date_end_date_unique' }); // Original name
  });
};