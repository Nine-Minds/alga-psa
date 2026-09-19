exports.up = function(knex) {
    return knex.schema.createTable('user_preferences', table => {
        table.uuid('tenant').notNullable();
        table.uuid('user_id').notNullable();
        table.text('setting_name').notNullable();
        table.jsonb('setting_value');
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        // Primary key
        table.primary(['tenant', 'user_id', 'setting_name']);

        // Foreign key constraints
        table.foreign(['tenant'], 'user_preferences_tenant_foreign')
            .references('tenant')
            .inTable('tenants')
            .onDelete('NO ACTION')
            .onUpdate('NO ACTION');

        table.foreign(['tenant', 'user_id'], 'user_preferences_user_id_foreign')
            .references(['tenant', 'user_id'])
            .inTable('users')
            .onDelete('NO ACTION')
            .onUpdate('NO ACTION');
    });
};

exports.down = function(knex) {
    return knex.schema.dropTableIfExists('user_preferences');
};
