/**
 * Citus requires DDL outside of transactions for distributed tables
 */
exports.config = { transaction: false };

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
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
    await knex.schema.raw(`
        UPDATE custom_fields
        SET type = 'text'
        WHERE type NOT IN ('text', 'number', 'date', 'boolean', 'picklist')
    `);

    // Convert the type column to use the enum
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ALTER COLUMN type TYPE custom_field_type USING type::custom_field_type
    `);

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

    // Add index for efficient querying by entity_type (includes field_order for sorting)
    // Note: If is_active is frequently toggled, consider replacing this with:
    // - A simpler index on (tenant, entity_type)
    // - A partial index WHERE is_active = true
    // This would reduce b-tree churn from status changes.
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_custom_fields_entity_type
        ON custom_fields(tenant, entity_type, is_active, field_order)
    `);

    // Add check constraint to limit picklist options to 200 to prevent unbounded bloat
    // Note: No check constraint needed for type since enum provides type safety
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
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
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

    // Convert type column back to text before dropping enum
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ALTER COLUMN type TYPE text USING type::text
    `);

    // Drop ENUM types with CASCADE to handle any dependencies
    // Note: CASCADE will also drop any columns/constraints using the enum
    await knex.schema.raw(`DROP TYPE IF EXISTS custom_field_entity_type CASCADE`);
    await knex.schema.raw(`DROP TYPE IF EXISTS custom_field_type CASCADE`);
};
