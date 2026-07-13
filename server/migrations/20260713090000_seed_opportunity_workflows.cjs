const path = require('path');
const MIGRATION_TENANT = 'migration:20260713090000_seed_opportunity_workflows';
const ENUMERATION_REASON = 'enumerate tenants for opportunity workflow backfill';
const ROLLBACK_REASON = 'remove seeded opportunity workflows across tenants';

exports.up = async function up(knex) {
  const { tenantDb } = require('./utils/tenantDb.cjs');
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const seedModule = require(path.resolve(
    __dirname,
    '../../ee/server/seeds/onboarding/psa/10_opportunity_workflows.cjs',
  ));
  const tenants = await migrationDb.unscoped('tenants', ENUMERATION_REASON).select('tenant');
  for (const row of tenants) {
    await seedModule.seed(knex, row.tenant);
  }
};

exports.down = async function down(knex) {
  const { tenantDb } = require('./utils/tenantDb.cjs');
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const keys = [
    'system.opportunity.stale-nudge',
    'system.opportunity.escalation',
    'system.opportunity.renewal-suggestions',
  ];
  const definitions = await migrationDb.unscoped('workflow_definitions', ROLLBACK_REASON)
    .whereIn('key', keys)
    .select('workflow_id');
  const ids = definitions.map((row) => row.workflow_id);
  if (ids.length) {
    await migrationDb.unscoped('tenant_workflow_schedule', ROLLBACK_REASON).whereIn('workflow_id', ids).del();
    await migrationDb.unscoped('workflow_definition_versions', ROLLBACK_REASON).whereIn('workflow_id', ids).del();
    await migrationDb.unscoped('workflow_definitions', ROLLBACK_REASON).whereIn('workflow_id', ids).del();
  }
};
