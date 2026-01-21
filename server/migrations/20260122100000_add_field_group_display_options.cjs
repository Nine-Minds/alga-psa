/**
 * Migration: Add Field Group Display Options
 *
 * Enhances custom_field_groups with:
 * - display_style: 'collapsible' | 'tab' | 'section' for UI rendering mode
 * - icon: optional icon identifier for visual representation
 *
 * These additions support the Halo-style tabbed field groups UI.
 *
 * Citus requires DDL outside of transactions for distributed tables
 */
exports.config = { transaction: false };

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // =================================================================
    // Add display_style column for UI rendering mode
    // =================================================================

    // Create enum type for display style
    await knex.schema.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'field_group_display_style') THEN
                CREATE TYPE field_group_display_style AS ENUM ('collapsible', 'tab', 'section');
            END IF;
        END
        $$;
    `);
    console.log('✓ Created field_group_display_style enum type');

    // Add display_style column with default 'collapsible' (maintains backward compatibility)
    await knex.schema.raw(`
        ALTER TABLE custom_field_groups
        ADD COLUMN IF NOT EXISTS display_style field_group_display_style NOT NULL DEFAULT 'collapsible'
    `);
    console.log('✓ Added display_style column to custom_field_groups');

    // =================================================================
    // Add icon column for visual representation
    // =================================================================

    await knex.schema.raw(`
        ALTER TABLE custom_field_groups
        ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT NULL
    `);
    console.log('✓ Added icon column to custom_field_groups');

    console.log('✓ Completed field group display options migration');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Remove icon column
    await knex.schema.raw(`
        ALTER TABLE custom_field_groups
        DROP COLUMN IF EXISTS icon
    `);
    console.log('✓ Dropped icon column');

    // Remove display_style column
    await knex.schema.raw(`
        ALTER TABLE custom_field_groups
        DROP COLUMN IF EXISTS display_style
    `);
    console.log('✓ Dropped display_style column');

    // Drop enum type
    await knex.schema.raw(`
        DROP TYPE IF EXISTS field_group_display_style
    `);
    console.log('✓ Dropped field_group_display_style enum type');
};
