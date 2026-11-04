/** Bound omission-protection lookups to candidate alert IDs. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('rmm_condition_states', (table) => {
    table.index(
      ['tenant', 'integration_id', 'current_external_alert_id'],
      'idx_rmm_condition_states_alert_owner',
    );
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('rmm_condition_states', (table) => {
    table.dropIndex(
      ['tenant', 'integration_id', 'current_external_alert_id'],
      'idx_rmm_condition_states_alert_owner',
    );
  });
};
