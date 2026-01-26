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
 * - Creates custom_field_groups table (Citus-compatible with composite PK)
 * - Adds group_id column to custom_fields with composite FK (group_id, tenant)
 *
 * Phase 4: Per-Client Field Templates
 * - Creates company_custom_field_settings table (Citus-compatible with composite PK)
 *
 * Citus requires DDL outside of transactions for distributed tables
 */
exports.config = { transaction: false };

const { isCitusAvailable, isTableDistributed, distributeTableIfNeeded } = require('./_utils.cjs');

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
    console.log('✓ Added conditional_logic column to custom_fields');

    // =================================================================
    // Phase 2: Multi-select Picklists
    // =================================================================

    // Add 'multi_picklist' to the custom_field_type enum
    // Using ADD VALUE IF NOT EXISTS (Postgres 13+)
    await knex.schema.raw(`
        DO $$
        BEGIN
            ALTER TYPE custom_field_type ADD VALUE IF NOT EXISTS 'multi_picklist';
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END
        $$;
    `);
    console.log('✓ Added multi_picklist to custom_field_type enum');

    // =================================================================
    // Phase 3: Field Grouping
    // =================================================================

    // Create custom_field_groups table for organizing fields into sections
    // Citus-compatible: composite primary key (group_id, tenant)
    // Distribution: Will be distributed on 'tenant' column, colocated with tenants table
    await knex.schema.raw(`
        CREATE TABLE IF NOT EXISTS custom_field_groups (
            group_id UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant UUID NOT NULL REFERENCES tenants(tenant),
            entity_type custom_field_entity_type NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            group_order INTEGER NOT NULL DEFAULT 0,
            is_collapsed_by_default BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (group_id, tenant)
        )
    `);
    console.log('✓ Created custom_field_groups table with composite PK (group_id, tenant)');

    // Add index for efficient group lookups (tenant first for Citus)
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_custom_field_groups_tenant_entity
        ON custom_field_groups(tenant, entity_type, group_order)
    `);

    // Distribute custom_field_groups if Citus is available
    await distributeTableIfNeeded(knex, 'custom_field_groups');

    // Add group_id column to custom_fields for linking to groups
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS group_id UUID DEFAULT NULL
    `);

    // Add composite foreign key constraint (group_id, tenant) -> custom_field_groups(group_id, tenant)
    // This ensures the FK works correctly with Citus distribution by including tenant
    await knex.schema.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_custom_fields_group'
            ) THEN
                ALTER TABLE custom_fields
                ADD CONSTRAINT fk_custom_fields_group
                FOREIGN KEY (group_id, tenant) REFERENCES custom_field_groups(group_id, tenant)
                ON DELETE SET NULL;
            END IF;
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END
        $$;
    `);
    console.log('✓ Added group_id to custom_fields with composite FK (group_id, tenant)');

    // =================================================================
    // Phase 4: Per-Client Field Templates
    // =================================================================

    // Create company_custom_field_settings table for per-client field configuration
    // Citus-compatible: composite primary key (setting_id, tenant)
    // Distribution: Will be distributed on 'tenant' column, colocated with tenants table
    await knex.schema.raw(`
        CREATE TABLE IF NOT EXISTS company_custom_field_settings (
            setting_id UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant UUID NOT NULL REFERENCES tenants(tenant),
            company_id UUID NOT NULL,
            field_id UUID NOT NULL,
            is_enabled BOOLEAN NOT NULL DEFAULT true,
            override_default_value JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (setting_id, tenant)
        )
    `);
    console.log('✓ Created company_custom_field_settings table with composite PK (setting_id, tenant)');

    // Add unique constraint including tenant for Citus co-location
    await knex.schema.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'unique_tenant_company_field'
            ) THEN
                ALTER TABLE company_custom_field_settings
                ADD CONSTRAINT unique_tenant_company_field
                UNIQUE(tenant, company_id, field_id);
            END IF;
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END
        $$;
    `);

    // Add composite foreign key to companies (company_id, tenant)
    await knex.schema.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_company_settings_company'
            ) THEN
                ALTER TABLE company_custom_field_settings
                ADD CONSTRAINT fk_company_settings_company
                FOREIGN KEY (company_id, tenant) REFERENCES companies(company_id, tenant)
                ON DELETE CASCADE;
            END IF;
        EXCEPTION
            WHEN others THEN
                -- If composite FK fails, the companies table may not have composite PK
                -- Skip FK constraint in this case
                RAISE NOTICE 'Could not add composite FK to companies: %', SQLERRM;
        END
        $$;
    `);

    // Add composite foreign key to custom_fields (field_id, tenant)
    await knex.schema.raw(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_company_settings_field'
            ) THEN
                ALTER TABLE company_custom_field_settings
                ADD CONSTRAINT fk_company_settings_field
                FOREIGN KEY (field_id, tenant) REFERENCES custom_fields(field_id, tenant)
                ON DELETE CASCADE;
            END IF;
        EXCEPTION
            WHEN others THEN
                -- If composite FK fails, custom_fields may not have composite PK yet
                RAISE NOTICE 'Could not add composite FK to custom_fields: %', SQLERRM;
        END
        $$;
    `);

    // Add index for efficient company field lookups (tenant first for Citus)
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_company_custom_field_settings_company
        ON company_custom_field_settings(tenant, company_id, is_enabled)
    `);

    // Add index for field lookups (tenant first for Citus)
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_company_custom_field_settings_field
        ON company_custom_field_settings(tenant, field_id)
    `);

    // Distribute company_custom_field_settings if Citus is available
    await distributeTableIfNeeded(knex, 'company_custom_field_settings');

    console.log('✓ Completed advanced custom field features migration');
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
    console.log('✓ Dropped company_custom_field_settings table');

    // =================================================================
    // Phase 3: Field Grouping (reverse)
    // =================================================================

    // Remove foreign key constraint first
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP CONSTRAINT IF EXISTS fk_custom_fields_group
    `);

    // Remove group_id from custom_fields
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP COLUMN IF EXISTS group_id
    `);

    await knex.schema.raw(`DROP INDEX IF EXISTS idx_custom_field_groups_tenant_entity`);
    await knex.schema.raw(`DROP TABLE IF EXISTS custom_field_groups`);
    console.log('✓ Dropped custom_field_groups table');

    // =================================================================
    // Phase 2: Multi-select Picklists (reverse)
    // =================================================================

    // Note: Cannot remove enum values in PostgreSQL without recreating the type
    // This is a known limitation. The 'multi_picklist' value will remain but unused.
    console.log('  Note: multi_picklist enum value retained (PostgreSQL limitation)');

    // =================================================================
    // Phase 1: Conditional Logic (reverse)
    // =================================================================

    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP COLUMN IF EXISTS conditional_logic
    `);
    console.log('✓ Dropped conditional_logic column');
};
