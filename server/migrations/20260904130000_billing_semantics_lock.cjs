const { canCreateDistributedTable, isDistributed } = require('./utils/citusDistribution.cjs');

const tables = [
  'billing_semantics_locks',
  'usage_period_totals', 'usage_period_total_requests', 'usage_tracking',
  'contract_line_service_configuration', 'contract_line_service_usage_config',
  'contract_line_service_fixed_config', 'contract_line_service_rate_tiers',
  'contract_line_unit_pricing_revisions', 'contract_line_services',
  'contract_lines', 'contracts', 'client_contracts', 'recurring_service_periods',
  'service_catalog', 'service_prices',
];
exports.up = async function(knex) {
  await knex.schema.createTable('billing_semantics_locks', table => { table.uuid('tenant').primary(); });
  const citus = await knex.raw("select exists(select 1 from pg_proc where proname='create_distributed_table') as present");
  if (citus.rows[0].present) await knex.raw("select create_distributed_table('billing_semantics_locks', 'tenant', colocate_with => 'tenants')");
  await knex.raw(`CREATE OR REPLACE FUNCTION lock_billing_semantics_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.tenant, OLD.tenant)::text || ':billing-semantics', 0));
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$`);
  // Citus does not support triggers on distributed tables. There the
  // per-tenant billing advisory lock is taken by the application
  // (lockTenantBilling) on the coordinator — the only lock domain a
  // distributed write shares; a worker-side trigger lock would not even
  // conflict with it. The trigger is defense-in-depth for plain-Postgres
  // deployments and any table Citus leaves local.
  // (pg_dist_partition only exists under Citus, so gate the isDistributed
  // probe on the extension being present.)
  const hasCitus = await canCreateDistributedTable(knex);
  for (const table of tables) {
    if (await knex.schema.hasTable(table)) {
      if (hasCitus && (await isDistributed(knex, table))) continue;
      await knex.raw('CREATE TRIGGER billing_semantics_mutation BEFORE INSERT OR UPDATE OR DELETE ON ?? FOR EACH ROW EXECUTE FUNCTION lock_billing_semantics_mutation()', [table]);
    }
  }
};
exports.down = async function(knex) {
  for (const table of tables) {
    if (await knex.schema.hasTable(table)) await knex.raw('DROP TRIGGER IF EXISTS billing_semantics_mutation ON ??', [table]);
  }
  await knex.raw('DROP FUNCTION IF EXISTS lock_billing_semantics_mutation()');
  await knex.schema.dropTableIfExists('billing_semantics_locks');
};
