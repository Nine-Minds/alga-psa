/**
 * Migration: Create Ticket Templates
 *
 * Creates the ticket_templates table for storing ticket type templates
 * with ITIL workflow support (New Hire, Change Request, etc.)
 *
 * Templates define:
 * - Default field values (title, description, priority, etc.)
 * - Custom field defaults
 * - Required fields override
 * - ITIL-specific configuration
 *
 * Citus requires DDL outside of transactions for distributed tables
 */
exports.config = { transaction: false };

const { distributeTableIfNeeded } = require('./_utils.cjs');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // =================================================================
    // Create ticket_templates table
    // =================================================================

    await knex.schema.raw(`
        CREATE TABLE IF NOT EXISTS ticket_templates (
            template_id UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant UUID NOT NULL REFERENCES tenants(tenant),
            name VARCHAR(255) NOT NULL,
            description TEXT,
            -- Template type: 'itil' for pre-built ITIL templates, 'custom' for user-created
            template_type VARCHAR(20) NOT NULL DEFAULT 'custom'
                CHECK (template_type IN ('itil', 'custom')),
            -- Optional association with a specific board
            board_id UUID DEFAULT NULL,
            -- Optional association with a specific category
            category_id UUID DEFAULT NULL,
            -- Default values for standard ticket fields
            -- Schema: { title?, description?, priority_id?, status_id?, assigned_to?, itil_impact?, itil_urgency? }
            default_values JSONB NOT NULL DEFAULT '{}'::jsonb,
            -- Default values for custom fields
            -- Schema: { [field_id]: value }
            custom_field_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
            -- Override which fields are required (field names)
            -- Schema: ["title", "description", "custom_field_id_xxx"]
            required_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
            -- Field layout configuration
            -- Schema: { visible_groups?: string[], hidden_fields?: string[] }
            field_layout JSONB NOT NULL DEFAULT '{}'::jsonb,
            -- ITIL-specific configuration
            -- Schema: { default_impact?, default_urgency?, checklist_items?: string[], suggested_resolution_steps?: string[] }
            itil_config JSONB DEFAULT NULL,
            -- Active/inactive flag
            is_active BOOLEAN NOT NULL DEFAULT true,
            -- Display order in template lists
            display_order INTEGER NOT NULL DEFAULT 0,
            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            -- Citus-compatible composite primary key
            PRIMARY KEY (template_id, tenant)
        )
    `);
    console.log('✓ Created ticket_templates table with composite PK (template_id, tenant)');

    // =================================================================
    // Create indexes for efficient lookups
    // =================================================================

    // Index for board-specific template lookups
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_ticket_templates_board
        ON ticket_templates(tenant, board_id, is_active)
        WHERE board_id IS NOT NULL
    `);

    // Index for category-specific template lookups
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_ticket_templates_category
        ON ticket_templates(tenant, category_id, is_active)
        WHERE category_id IS NOT NULL
    `);

    // Index for template type filtering
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_ticket_templates_type
        ON ticket_templates(tenant, template_type, is_active, display_order)
    `);

    // Index for active templates ordered by display_order
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_ticket_templates_active
        ON ticket_templates(tenant, is_active, display_order)
        WHERE is_active = true
    `);

    console.log('✓ Created indexes for ticket_templates');

    // =================================================================
    // Distribute table if Citus is available
    // =================================================================

    await distributeTableIfNeeded(knex, 'ticket_templates');

    console.log('✓ Completed ticket_templates migration');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Drop indexes
    await knex.schema.raw(`DROP INDEX IF EXISTS idx_ticket_templates_active`);
    await knex.schema.raw(`DROP INDEX IF EXISTS idx_ticket_templates_type`);
    await knex.schema.raw(`DROP INDEX IF EXISTS idx_ticket_templates_category`);
    await knex.schema.raw(`DROP INDEX IF EXISTS idx_ticket_templates_board`);

    // Drop table
    await knex.schema.raw(`DROP TABLE IF EXISTS ticket_templates`);

    console.log('✓ Dropped ticket_templates table and indexes');
};
