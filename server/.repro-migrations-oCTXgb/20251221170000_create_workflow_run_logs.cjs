exports.up = async function (knex) {
  await knex.schema.createTable('workflow_run_logs', (table) => {
    table.uuid('log_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('run_id').notNullable().references('run_id').inTable('workflow_runs').onDelete('CASCADE');
    table.text('tenant_id');
    table.uuid('step_id');
    table.text('step_path');
    table.text('level').notNullable();
    table.text('message').notNullable();
    table.jsonb('context_json');
    table.text('correlation_key');
    table.text('event_name');
    table.text('source');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['run_id', 'created_at'], 'idx_workflow_run_logs_run_created');
    table.index(['run_id', 'level'], 'idx_workflow_run_logs_run_level');
    table.index(['tenant_id', 'created_at'], 'idx_workflow_run_logs_tenant_created');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('workflow_run_logs');
};
