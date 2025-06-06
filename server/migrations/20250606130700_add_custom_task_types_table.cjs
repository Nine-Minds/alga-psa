exports.up = async function(knex) {
    // Create custom task types table (tenant-specific)
    await knex.schema.createTable('custom_task_types', table => {
        table.uuid('tenant').notNullable();
        table.uuid('type_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.string('type_key', 50).notNullable();
        table.string('type_name', 100).notNullable();
        table.string('icon', 50);
        table.string('color', 7);
        table.integer('display_order').notNullable().defaultTo(999);
        table.boolean('is_active').notNullable().defaultTo(true);
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        
        table.primary(['tenant', 'type_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.unique(['tenant', 'type_key']);
        table.index(['tenant', 'display_order']);
    });
};

exports.down = async function(knex) {
    await knex.schema.dropTableIfExists('custom_task_types');
};