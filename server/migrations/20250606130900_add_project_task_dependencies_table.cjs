exports.up = async function(knex) {
    // Create task dependencies table with advanced scheduling support
    await knex.schema.createTable('project_task_dependencies', table => {
        table.uuid('tenant').notNullable();
        table.uuid('dependency_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('predecessor_task_id').notNullable().comment('The task that must complete/start first');
        table.uuid('successor_task_id').notNullable().comment('The task that depends on the predecessor');
        table.enum('dependency_type', [
            'blocks',            // This task blocks the other task
            'blocked_by',        // This task is blocked by the other task  
            'related_to'         // General relationship
        ]).notNullable().defaultTo('related_to');
        table.integer('lead_lag_days').defaultTo(0).comment('Positive for lag, negative for lead time');
        table.text('notes');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        
        table.primary(['tenant', 'dependency_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'predecessor_task_id']).references(['tenant', 'task_id']).inTable('project_tasks');
        table.foreign(['tenant', 'successor_task_id']).references(['tenant', 'task_id']).inTable('project_tasks');
        table.index(['tenant', 'predecessor_task_id']);
        table.index(['tenant', 'successor_task_id']);
        table.unique(['tenant', 'predecessor_task_id', 'successor_task_id', 'dependency_type'], 'idx_unique_dependency_per_type');
    });
};

exports.down = async function(knex) {
    await knex.schema.dropTableIfExists('project_task_dependencies');
};