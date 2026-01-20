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
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_custom_fields_entity_type
        ON custom_fields(tenant, entity_type, is_active, field_order)
    `);

    // Add check constraint for valid field types (extend existing 'type' column)
    // Note: entity_type uses ENUM so no check constraint needed for that
    await knex.schema.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'chk_custom_fields_field_type'
            ) THEN
                ALTER TABLE custom_fields
                ADD CONSTRAINT chk_custom_fields_field_type
                CHECK (type IN ('text', 'number', 'date', 'boolean', 'picklist'));
            END IF;
        END
        $$;
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
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Remove constraints (only ones we created)
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP CONSTRAINT IF EXISTS chk_custom_fields_field_type
    `);

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

    // Drop ENUM types (only if not used elsewhere)
    await knex.schema.raw(`DROP TYPE IF EXISTS custom_field_entity_type`);
    await knex.schema.raw(`DROP TYPE IF EXISTS custom_field_type`);
};
