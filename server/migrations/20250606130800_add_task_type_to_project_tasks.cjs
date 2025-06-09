exports.up = async function(knex) {
    await knex.schema.alterTable('project_tasks', table => {
        table.string('task_type_key', 50).notNullable().defaultTo('task');
        table.index(['tenant', 'task_type_key']);
    });
};

exports.down = async function(knex) {
    await knex.schema.alterTable('project_tasks', table => {
        table.dropColumn('task_type_key');
    });
};