exports.up = async function(knex) {
    await knex.schema.createTable('task_resources', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('assignment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('task_id').notNullable();
        table.uuid('assigned_to').notNullable();
        table.uuid('additional_user_id');
        table.text('role');
        table.timestamp('assigned_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'assignment_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'task_id']).references(['tenant', 'task_id']).inTable('project_tasks');
        table.foreign(['tenant', 'assigned_to']).references(['tenant', 'user_id']).inTable('users');
        table.foreign(['tenant', 'additional_user_id']).references(['tenant', 'user_id']).inTable('users');
        table.check('assigned_to != additional_user_id');
    });

    await knex.schema.raw('CREATE INDEX idx_task_resources_task_user ON task_resources (tenant, task_id, additional_user_id)');
};

exports.down = async function(knex) {
    await knex.schema.dropTable('task_resources');
};
