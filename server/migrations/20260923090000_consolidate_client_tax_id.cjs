/**
 * Consolidate clients.properties.tax_id into clients.tax_id_number.
 * Conflicts are written to client_tax_id_migration_conflicts, a tenant-scoped
 * durable audit table. It is separate from audit_logs because that table's
 * tenant insert trigger and RLS require session tenant state; migration writes
 * instead use the tenant facade and carry tenant explicitly. The table is
 * distributed and colocated by tenant with clients. It has no client foreign
 * key so client deletion cannot erase or block the durable audit record. Down
 * intentionally keeps the table and its records; dropping them would destroy
 * conflict data.
 */
const { tenantDb } = require('./utils/tenantDb.cjs');
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const MIGRATION_TENANT = 'migration:20260923090000_consolidate_client_tax_id';
const TENANT_ENUMERATION_REASON = 'enumerate tenants to consolidate client tax IDs';

exports.consolidateTenant = async function consolidateTenant(knex, tenant) {
  const db = tenantDb(knex, tenant);
  const conflicts = await db.table('clients')
    .whereRaw("NULLIF(BTRIM(tax_id_number), '') IS NOT NULL")
    .whereRaw("NULLIF(BTRIM(properties->>'tax_id'), '') IS NOT NULL")
    .whereRaw("BTRIM(tax_id_number) IS DISTINCT FROM BTRIM(properties->>'tax_id')")
    .select(
      'tenant',
      'client_id',
      'client_name',
      knex.raw('BTRIM(tax_id_number) AS canonical_value'),
      knex.raw("BTRIM(properties->>'tax_id') AS discarded_legacy_value")
    );
  for (const conflict of conflicts) {
    await db.table('client_tax_id_migration_conflicts')
      .insert({ ...conflict, migrated_at: knex.fn.now() })
      .onConflict(['tenant', 'client_id']).ignore();
  }

  await db.table('clients').where({ tenant })
    .whereRaw("NULLIF(BTRIM(tax_id_number), '') IS NULL")
    .whereRaw("NULLIF(BTRIM(properties->>'tax_id'), '') IS NOT NULL")
    .update({ tax_id_number: knex.raw("BTRIM(properties->>'tax_id')") });
  await db.table('clients').where({ tenant })
    .whereRaw("jsonb_exists(properties, 'tax_id')")
    .update({ properties: knex.raw("properties - 'tax_id'") });
};

exports.up = async function up(knex) {
  // Guarded: with transaction:false a failure after this CREATE (for example
  // during tenant consolidation) leaves the table behind for the retry.
  if (!(await knex.schema.hasTable('client_tax_id_migration_conflicts'))) {
    await knex.schema.createTable('client_tax_id_migration_conflicts', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('conflict_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('client_id').notNullable();
      table.text('client_name').notNullable();
      table.text('canonical_value').notNullable();
      table.text('discarded_legacy_value').notNullable();
      table.timestamp('migrated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'conflict_id']);
      table.unique(['tenant', 'client_id'], 'client_tax_id_migration_conflicts_tenant_client_unique');
    });
  }
  // ensureTenantDistribution checks pg_dist_partition first and returns when
  // this table is already distributed, so it is safe on a migration retry.
  await ensureTenantDistribution(knex, 'client_tax_id_migration_conflicts');

  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  for (const { tenant } of tenants) await exports.consolidateTenant(knex, tenant);
};

exports.down = async function down() {
  // Documented no-op: client data cannot be rolled back without restoring ambiguity.
  // The durable conflict audit is also retained to avoid destroying evidence.
};

exports.config = { transaction: false };
