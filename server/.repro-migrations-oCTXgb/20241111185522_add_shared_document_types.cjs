/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Create shared document types table
    await knex.schema.createTable('shared_document_types', (table) => {
        table.uuid('type_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
        table.text('type_name').notNullable();
        table.text('icon');
        table.string('description', 255);
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    // Add shared type reference to documents table
    await knex.schema.alterTable('documents', (table) => {
        // Add new column for shared type reference
        table.uuid('shared_type_id').references('type_id').inTable('shared_document_types');
    });

    // Create trigger to update updated_at timestamp
    await knex.raw(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ language 'plpgsql';

        CREATE TRIGGER update_shared_document_types_updated_at
            BEFORE UPDATE ON shared_document_types
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Remove trigger first
    await knex.raw(`
        DROP TRIGGER IF EXISTS update_shared_document_types_updated_at ON shared_document_types;
    `);

    // Remove shared type reference from documents
    await knex.schema.alterTable('documents', (table) => {
        table.dropColumn('shared_type_id');
    });

    // Drop the shared document types table
    await knex.schema.dropTableIfExists('shared_document_types');

    // Drop the trigger function
    await knex.raw(`DROP FUNCTION IF EXISTS update_updated_at_column()`);
};
