exports.up = async function up(knex) {
  await knex.schema.alterTable('workflow_action_invocations', (table) => {
    table.jsonb('error_json');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('workflow_action_invocations', (table) => {
    table.dropColumn('error_json');
  });
};
