/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Add new columns to custom_fields table for UDF support
    await knex.schema.alterTable('custom_fields', (table) => {
        // Entity type this field belongs to: 'ticket', 'company', or 'contact'
        table.text('entity_type').notNullable().defaultTo('ticket');
        // Display order for the field
        table.integer('field_order').notNullable().defaultTo(0);
        // Whether the field is required
        table.boolean('is_required').notNullable().defaultTo(false);
        // Whether the field is active (soft delete)
        table.boolean('is_active').notNullable().defaultTo(true);
        // Options for picklist type fields (stored as JSON array)
        table.jsonb('options');
        // Description/help text for the field
        table.text('description');
    });

    // Add index for efficient querying by entity_type
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_custom_fields_entity_type
        ON custom_fields(tenant, entity_type, is_active)
    `);

    // Add check constraint for valid entity types
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD CONSTRAINT chk_custom_fields_entity_type
        CHECK (entity_type IN ('ticket', 'company', 'contact'))
    `);

    // Add check constraint for valid field types (extend existing types)
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        ADD CONSTRAINT chk_custom_fields_type
        CHECK (type IN ('text', 'number', 'date', 'boolean', 'picklist'))
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Remove constraints
    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP CONSTRAINT IF EXISTS chk_custom_fields_entity_type
    `);

    await knex.schema.raw(`
        ALTER TABLE custom_fields
        DROP CONSTRAINT IF EXISTS chk_custom_fields_type
    `);

    // Remove index
    await knex.schema.raw(`
        DROP INDEX IF EXISTS idx_custom_fields_entity_type
    `);

    // Remove added columns
    await knex.schema.alterTable('custom_fields', (table) => {
        table.dropColumn('entity_type');
        table.dropColumn('field_order');
        table.dropColumn('is_required');
        table.dropColumn('is_active');
        table.dropColumn('options');
        table.dropColumn('description');
    });
};
