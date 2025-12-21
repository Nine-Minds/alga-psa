const EMAIL_SYSTEM_WORKFLOW_ID = '00000000-0000-0000-0000-00000000e001';

exports.up = async function (knex) {
  await knex.schema.alterTable('workflow_definitions', (table) => {
    table.boolean('is_system').notNullable().defaultTo(false);
    table.boolean('is_visible').notNullable().defaultTo(true);
    table.boolean('is_paused').notNullable().defaultTo(false);
    table.integer('concurrency_limit');
    table.boolean('auto_pause_on_failure').notNullable().defaultTo(false);
    table.decimal('failure_rate_threshold', 5, 2).defaultTo(0.5);
    table.integer('failure_rate_min_runs').defaultTo(10);
    table.jsonb('retention_policy_override');
  });

  await knex('workflow_definitions')
    .where({ workflow_id: EMAIL_SYSTEM_WORKFLOW_ID })
    .update({ is_system: true });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('workflow_definitions', (table) => {
    table.dropColumn('retention_policy_override');
    table.dropColumn('failure_rate_min_runs');
    table.dropColumn('failure_rate_threshold');
    table.dropColumn('auto_pause_on_failure');
    table.dropColumn('concurrency_limit');
    table.dropColumn('is_paused');
    table.dropColumn('is_visible');
    table.dropColumn('is_system');
  });
};
