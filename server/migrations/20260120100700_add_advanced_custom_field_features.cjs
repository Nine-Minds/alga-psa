/**
 * Migration: Add Advanced Custom Field Features
 *
 * Phase 1: Conditional Logic
 * - Adds conditional_logic column for show/hide rules
 *
 * Phase 2: Multi-select Picklists
 * - Adds 'multi_picklist' to custom_field_type enum
 *
 * Phase 3: Field Grouping
 * - Creates custom_field_groups table
 * - Adds group_id foreign key to custom_fields
 *
 * Phase 4: Per-Client Field Templates
 * - Creates company_custom_field_settings table
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
    // Phase 1: Conditional Logic
    // =================================================================

    // Add conditional_logic column for show/hide rules based on other field values
    // Schema: { field_id: string, operator: string, value?: any }
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS conditional_logic JSONB DEFAULT NULL
    `);

    // =================================================================
    // Phase 2: Multi-select Picklists
    // =================================================================

    // Add 'multi_picklist' to the custom_field_type enum
    // Using safe pattern that handles "value already exists" error
    await knex.schema.raw(`
        DO $$
        BEGIN
            ALTER TYPE custom_field_type ADD VALUE IF NOT EXISTS 'multi_picklist';
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END
        $$;
    `);

    // =================================================================
    // Phase 3: Field Grouping
    // =================================================================

    // Create custom_field_groups table for organizing fields into sections
    await knex.schema.raw(`
        CREATE TABLE IF NOT EXISTS custom_field_groups (
            group_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant UUID NOT NULL REFERENCES tenants(tenant),
            entity_type custom_field_entity_type NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            group_order INTEGER NOT NULL DEFAULT 0,
            is_collapsed_by_default BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Add index for efficient group lookups
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_custom_field_groups_tenant_entity
        ON custom_field_groups(tenant, entity_type, group_order)
    `);

    // Add group_id foreign key to custom_fields
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES custom_field_groups(group_id) ON DELETE SET NULL
    `);

    // =================================================================
    // Phase 4: Per-Client Field Templates
    // =================================================================

    // Create company_custom_field_settings table for per-client field configuration
    await knex.schema.raw(`
        CREATE TABLE IF NOT EXISTS company_custom_field_settings (
            setting_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant UUID NOT NULL REFERENCES tenants(tenant),
            company_id UUID NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            field_id UUID NOT NULL REFERENCES custom_fields(field_id) ON DELETE CASCADE,
            is_enabled BOOLEAN NOT NULL DEFAULT true,
            override_default_value JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT unique_company_field UNIQUE(company_id, field_id)
        )
    `);

    // Add index for efficient company field lookups
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_company_custom_field_settings_company
        ON company_custom_field_settings(tenant, company_id, is_enabled)
    `);

    // Add index for field lookups
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_company_custom_field_settings_field
        ON company_custom_field_settings(tenant, field_id)
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // =================================================================
    // Phase 4: Per-Client Field Templates (reverse)
    // =================================================================

    await knex.schema.raw(`DROP INDEX IF EXISTS idx_company_custom_field_settings_field`);
    await knex.schema.raw(`DROP INDEX IF EXISTS idx_company_custom_field_settings_company`);
    await knex.schema.raw(`DROP TABLE IF EXISTS company_custom_field_settings`);

    // =================================================================
    // Phase 3: Field Grouping (reverse)
    // =================================================================

    // Remove group_id from custom_fields before dropping groups table
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP COLUMN IF EXISTS group_id
    `);

    await knex.schema.raw(`DROP INDEX IF EXISTS idx_custom_field_groups_tenant_entity`);
    await knex.schema.raw(`DROP TABLE IF EXISTS custom_field_groups`);

    // =================================================================
    // Phase 2: Multi-select Picklists (reverse)
    // =================================================================

    // Note: Cannot remove enum values in PostgreSQL without recreating the type
    // This is a known limitation. The 'multi_picklist' value will remain but unused.
    // Alternatively, convert any multi_picklist fields to picklist and recreate enum,
    // but this is complex and potentially destructive, so we leave the value in place.

    // =================================================================
    // Phase 1: Conditional Logic (reverse)
    // =================================================================

    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP COLUMN IF EXISTS conditional_logic
    `);
};
