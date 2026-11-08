/** Bound omission-protection lookups to candidate alert IDs. */
exports.config = { transaction: false };

exports.up = async function up(knex) {
  // LEVERAGE: pattern concurrent-index-recovery — probe validity before retrying Citus concurrent DDL.
  const index = await knex.raw(`SELECT i.indisvalid FROM pg_index i
    WHERE i.indexrelid = to_regclass('idx_rmm_condition_states_alert_owner')`);
  // Avoid Citus 12.1 invalidating a valid coordinator index on an IF NOT EXISTS
  // rerun, and recover an interrupted concurrent build before trying again.
  if (!index.rows[0]?.indisvalid) {
    await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_rmm_condition_states_alert_owner');
    await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rmm_condition_states_alert_owner
      ON rmm_condition_states (tenant, integration_id, current_external_alert_id)`);
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_rmm_condition_states_alert_owner');
};
