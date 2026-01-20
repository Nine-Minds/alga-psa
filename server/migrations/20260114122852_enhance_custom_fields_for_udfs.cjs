/**
 * Citus requires DDL outside of transactions for distributed tables
 */
exports.config = { transaction: false };

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Add new columns to custom_fields table for UDF support
    // Each column added separately for Citus compatibility
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'ticket'
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

    // Add check constraint for valid entity types (use IF NOT EXISTS pattern)
    await knex.schema.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'chk_custom_fields_entity_type'
            ) THEN
                ALTER TABLE custom_fields
                ADD CONSTRAINT chk_custom_fields_entity_type
                CHECK (entity_type IN ('ticket', 'company', 'contact'));
            END IF;
        END
        $$;
    `);

    // Add check constraint for valid field types (use unique name to avoid conflicts)
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
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Remove constraints (only ones we created)
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP CONSTRAINT IF EXISTS chk_custom_fields_entity_type
    `);

    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP CONSTRAINT IF EXISTS chk_custom_fields_field_type
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
};
