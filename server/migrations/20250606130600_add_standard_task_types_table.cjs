exports.up = async function(knex) {
    // Create standard task types as a reference table (shared across all tenants)
    await knex.schema.createTable('standard_task_types', table => {
        table.uuid('type_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
        table.string('type_key', 50).notNullable().unique();
        table.string('type_name', 100).notNullable();
        table.string('icon', 50); // lucide icon name
        table.string('color', 7); // hex color
        table.integer('display_order').notNullable().defaultTo(0);
        table.boolean('is_active').notNullable().defaultTo(true);
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        
        table.index('type_key');
        table.index('display_order');
    });
    
    // Insert standard task types
    await knex('standard_task_types').insert([
        { type_key: 'task', type_name: 'Task', icon: 'CheckSquare', color: '#4B5563', display_order: 1 },
        { type_key: 'bug', type_name: 'Bug', icon: 'Bug', color: '#DC2626', display_order: 2 },
        { type_key: 'feature', type_name: 'Feature', icon: 'Sparkles', color: '#10B981', display_order: 3 },
        { type_key: 'improvement', type_name: 'Improvement', icon: 'TrendingUp', color: '#3B82F6', display_order: 4 },
        { type_key: 'epic', type_name: 'Epic', icon: 'Flag', color: '#7C3AED', display_order: 5 },
        { type_key: 'story', type_name: 'Story', icon: 'BookOpen', color: '#F59E0B', display_order: 6 }
    ]);
};

exports.down = async function(knex) {
    await knex.schema.dropTableIfExists('standard_task_types');
};