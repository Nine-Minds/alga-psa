const { canCreateDistributedTable, isDistributed } = require('./utils/citusDistribution.cjs');

exports.up = async function(knex) {
  await knex.schema.createTable('usage_measurement_revisions', table => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.date('effective_period_start').notNullable();
    table.text('measurement_mode').notNullable();
    table.jsonb('pricing').nullable();
    table.timestamp('created_at', {useTz: true}).defaultTo(knex.fn.now());
    table.primary(['tenant', 'config_id', 'effective_period_start']);
  });
  const citus = await knex.raw("select exists(select 1 from pg_proc where proname='create_distributed_table') as present");
  if (citus.rows[0].present) await knex.raw("select create_distributed_table('usage_measurement_revisions', 'tenant')");
  await knex.raw("ALTER TABLE usage_measurement_revisions ADD CHECK (measurement_mode IN ('additive', 'period_total'))");
  // Citus does not support triggers on distributed tables; on Citus the
  // per-tenant billing advisory lock is the application-level
  // lockTenantBilling on the coordinator (see 20260904130000).
  // pg_dist_partition only exists under Citus, so gate the probe.
  if (!((await canCreateDistributedTable(knex)) && (await isDistributed(knex, 'usage_measurement_revisions')))) {
    await knex.raw('CREATE TRIGGER billing_semantics_mutation BEFORE INSERT OR UPDATE OR DELETE ON usage_measurement_revisions FOR EACH ROW EXECUTE FUNCTION lock_billing_semantics_mutation()');
  }
};
exports.down = async function(knex) { await knex.schema.dropTableIfExists('usage_measurement_revisions'); };
exports.config = { transaction: false };
