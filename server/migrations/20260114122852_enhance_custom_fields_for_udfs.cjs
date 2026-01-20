/**
 * Citus requires DDL outside of transactions for distributed tables
 */
exports.config = { transaction: false };

const { isCitusAvailable, isTableDistributed, runCommandOnShards } = require('./_utils.cjs');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    const citusAvailable = await isCitusAvailable(knex);
    const isDistributed = await isTableDistributed(knex, 'custom_fields');

    // Create ENUM types for better type safety and query performance
    // Using DO blocks to handle "type already exists" gracefully
    await knex.schema.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'custom_field_entity_type') THEN
                CREATE TYPE custom_field_entity_type AS ENUM ('ticket', 'company', 'contact');
            END IF;
        END
        $$;
    `);

    await knex.schema.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'custom_field_type') THEN
                CREATE TYPE custom_field_type AS ENUM ('text', 'number', 'date', 'boolean', 'picklist');
            END IF;
        END
        $$;
    `);

    // Convert existing 'type' column from text to enum
    // First, ensure any existing values are valid enum values (default invalid to 'text')
    // For Citus distributed tables, run UPDATE on each shard to avoid broadcast
    if (citusAvailable && isDistributed) {
        console.log('  Running UPDATE on distributed table via shards...');
        await runCommandOnShards(knex, 'custom_fields', `
            UPDATE %s
            SET type = 'text'
            WHERE type NOT IN ('text', 'number', 'date', 'boolean', 'picklist')
        `);
    } else {
        // For non-distributed tables, include tenant filter to avoid full-table scan
        await knex.schema.raw(`
            UPDATE custom_fields
            SET type = 'text'
            WHERE type NOT IN ('text', 'number', 'date', 'boolean', 'picklist')
            AND tenant IS NOT NULL
        `);
    }
    console.log('✓ Normalized invalid type values to text');

    // Convert the type column to use the enum
    // For Citus distributed tables, we need to handle this carefully
    if (citusAvailable && isDistributed) {
        console.log('  Running ALTER COLUMN TYPE on distributed table via shards...');
        await runCommandOnShards(knex, 'custom_fields', `
            ALTER TABLE %s
            ALTER COLUMN type TYPE custom_field_type USING type::custom_field_type
        `);
        // Also update the coordinator's metadata
        await knex.raw(`
            ALTER TABLE custom_fields
            ALTER COLUMN type TYPE custom_field_type USING type::custom_field_type
        `);
    } else {
        // For non-distributed tables (local dev), direct ALTER works fine
        await knex.schema.raw(`
            ALTER TABLE custom_fields
            ALTER COLUMN type TYPE custom_field_type USING type::custom_field_type
        `);
    }
    console.log('✓ Converted type column to enum');

    // Add new columns to custom_fields table for UDF support
    // Each column added separately for Citus compatibility
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS entity_type custom_field_entity_type NOT NULL DEFAULT 'ticket'
    `);

    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS field_order integer NOT NULL DEFAULT 0
    `);

    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS is_required boolean NOT NULL DEFAULT false
    `);

    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true
    `);

    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS options jsonb DEFAULT '[]'::jsonb
    `);

    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS description text
    `);
    console.log('✓ Added UDF columns to custom_fields');

    // Add index for efficient querying by entity_type (includes field_order for sorting)
    // Tenant is first column for Citus query optimization
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_custom_fields_entity_type
        ON custom_fields(tenant, entity_type, is_active, field_order)
    `);

    // Add check constraint to limit picklist options to 200 to prevent unbounded bloat
    await knex.schema.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'chk_custom_fields_options_length'
            ) THEN
                ALTER TABLE custom_fields
                ADD CONSTRAINT chk_custom_fields_options_length
                CHECK (options IS NULL OR jsonb_array_length(options) <= 200);
            END IF;
        END
        $$;
    `);
    console.log('✓ Added index and constraints');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    const citusAvailable = await isCitusAvailable(knex);
    const isDistributed = await isTableDistributed(knex, 'custom_fields');

    // Remove constraints (only ones we created)
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP CONSTRAINT IF EXISTS chk_custom_fields_options_length
    `);

    // Remove index
    await knex.schema.raw(`
        DROP INDEX IF EXISTS idx_custom_fields_entity_type
    `);

    // Remove added columns (each separately for Citus compatibility)
    await knex.schema.raw(`ALTER TABLE custom_fields DROP COLUMN IF EXISTS entity_type`);
    await knex.schema.raw(`ALTER TABLE custom_fields DROP COLUMN IF EXISTS field_order`);
    await knex.schema.raw(`ALTER TABLE custom_fields DROP COLUMN IF EXISTS is_required`);
    await knex.schema.raw(`ALTER TABLE custom_fields DROP COLUMN IF EXISTS is_active`);
    await knex.schema.raw(`ALTER TABLE custom_fields DROP COLUMN IF EXISTS options`);
    await knex.schema.raw(`ALTER TABLE custom_fields DROP COLUMN IF EXISTS description`);
    console.log('✓ Removed UDF columns from custom_fields');

    // Convert type column back to text before dropping enum
    // Handle distributed tables carefully
    if (citusAvailable && isDistributed) {
        console.log('  Running ALTER COLUMN TYPE on distributed table via shards...');
        await runCommandOnShards(knex, 'custom_fields', `
            ALTER TABLE %s
            ALTER COLUMN type TYPE text USING type::text
        `);
        await knex.raw(`
            ALTER TABLE custom_fields
            ALTER COLUMN type TYPE text USING type::text
        `);
    } else {
        await knex.schema.raw(`
            ALTER TABLE custom_fields
            ALTER COLUMN type TYPE text USING type::text
        `);
    }
    console.log('✓ Converted type column back to text');

    // Drop ENUM types
    // Note: We already converted the column to text above, so these should be safe to drop
    // Using IF EXISTS to handle cases where types don't exist
    // Avoiding CASCADE to prevent accidental drops of other dependent objects
    await knex.schema.raw(`DROP TYPE IF EXISTS custom_field_entity_type`);
    await knex.schema.raw(`DROP TYPE IF EXISTS custom_field_type`);
    console.log('✓ Dropped enum types');
};
