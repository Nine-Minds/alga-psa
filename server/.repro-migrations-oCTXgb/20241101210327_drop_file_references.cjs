/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Drop the file_references table since documents table handles the entity relationships
    await knex.schema.dropTable('file_references');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Recreate the file_references table in case we need to rollback
    await knex.schema.createTable('file_references', table => {
        table.uuid('reference_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.string('tenant').notNullable();
        table.uuid('file_id').notNullable();
        table.string('entity_type').notNullable();
        table.string('entity_id').notNullable();
        table.string('created_by').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        
        table.foreign(['tenant', 'file_id'])
            .references(['tenant', 'file_id'])
            .inTable('file_stores')
            .onDelete('CASCADE');
            
        table.index(['tenant', 'entity_type', 'entity_id']);
    });
};
