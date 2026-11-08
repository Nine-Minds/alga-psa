/** Bound omission-protection lookups to candidate alert IDs. */
const { ensureConcurrentIndex, dropConcurrentIndex } = require('./utils/concurrentIndex.cjs');
exports.config = { transaction: false };

exports.up = async function up(knex) {
  await ensureConcurrentIndex(knex, 'rmm_condition_states', 'idx_rmm_condition_states_alert_owner',
    ['tenant', 'integration_id', 'current_external_alert_id']);
};

exports.down = async function down(knex) {
  await dropConcurrentIndex(knex, 'rmm_condition_states', 'idx_rmm_condition_states_alert_owner');
};
