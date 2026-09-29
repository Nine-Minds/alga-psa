exports.up = async knex => {
  await knex.schema.alterTable('workflow_action_invocations', table => {
    table.jsonb('replay_output_encrypted').nullable();
  });
};

exports.down = async knex => {
  if (await knex('workflow_action_invocations').whereNotNull('replay_output_encrypted').first()) {
    throw new Error('Cannot remove protected workflow replay output while encrypted results exist');
  }
  await knex.schema.alterTable('workflow_action_invocations', table => {
    table.dropColumn('replay_output_encrypted');
  });
};
