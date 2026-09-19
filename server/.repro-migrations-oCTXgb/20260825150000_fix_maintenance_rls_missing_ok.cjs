const maintenanceTables = [
  'asset_maintenance_occurrences',
  'asset_maintenance_schedules',
  'asset_maintenance_notifications',
  'asset_maintenance_history',
];

async function recreateTenantPolicies(knex, tenantExpression) {
  for (const table of maintenanceTables) {
    // Keep each utility statement separate: Citus rejects multiple utility
    // events issued together against a distributed table.
    await knex.raw(`DROP POLICY IF EXISTS tenant_isolation_policy ON ${table}`);
    await knex.raw(
      `CREATE POLICY tenant_isolation_policy ON ${table} USING (tenant::TEXT = ${tenantExpression}::TEXT)`
    );
  }
}

exports.up = async function up(knex) {
  await recreateTenantPolicies(knex, "current_setting('app.current_tenant', true)");
};

exports.down = async function down(knex) {
  await recreateTenantPolicies(knex, "current_setting('app.current_tenant')");
};
