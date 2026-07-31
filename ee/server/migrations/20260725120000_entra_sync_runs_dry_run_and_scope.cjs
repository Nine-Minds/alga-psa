/**
 * Migration: entra_sync_runs preflight + scope columns (EE-only).
 *
 * `is_dry_run` marks a preflight: a run that read the directory, classified
 * every identity, and wrote nothing. Preflights are kept as audit evidence
 * ("preview run at 14:22") but must never count as real syncs — every health
 * aggregate, attention signal and the setup→console switch filters them out.
 *
 * `scope_managed_tenant_id` / `scope_client_id` record what a run covered, so
 * history can say "Contoso only" instead of leaving a single-tenant run
 * indistinguishable from an all-tenants one.
 *
 * ADD COLUMN propagates to shards automatically on a distributed Citus table,
 * so no create_distributed_table dance is needed. Idempotent via hasColumn.
 */

const TABLE = 'entra_sync_runs';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    return;
  }

  const [hasIsDryRun, hasScopeManagedTenant, hasScopeClient] = await Promise.all([
    knex.schema.hasColumn(TABLE, 'is_dry_run'),
    knex.schema.hasColumn(TABLE, 'scope_managed_tenant_id'),
    knex.schema.hasColumn(TABLE, 'scope_client_id'),
  ]);

  if (hasIsDryRun && hasScopeManagedTenant && hasScopeClient) {
    return;
  }

  await knex.schema.alterTable(TABLE, (table) => {
    if (!hasIsDryRun) {
      table.boolean('is_dry_run').notNullable().defaultTo(false);
    }
    if (!hasScopeManagedTenant) {
      table.uuid('scope_managed_tenant_id').nullable();
    }
    if (!hasScopeClient) {
      table.uuid('scope_client_id').nullable();
    }
  });

  if (!hasIsDryRun) {
    // Every run that predates preflight was a real one.
    await knex(TABLE).update({ is_dry_run: false });
  }
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    return;
  }

  const [hasIsDryRun, hasScopeManagedTenant, hasScopeClient] = await Promise.all([
    knex.schema.hasColumn(TABLE, 'is_dry_run'),
    knex.schema.hasColumn(TABLE, 'scope_managed_tenant_id'),
    knex.schema.hasColumn(TABLE, 'scope_client_id'),
  ]);

  await knex.schema.alterTable(TABLE, (table) => {
    if (hasIsDryRun) {
      table.dropColumn('is_dry_run');
    }
    if (hasScopeManagedTenant) {
      table.dropColumn('scope_managed_tenant_id');
    }
    if (hasScopeClient) {
      table.dropColumn('scope_client_id');
    }
  });
};
