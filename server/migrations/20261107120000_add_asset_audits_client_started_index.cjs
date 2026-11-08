'use strict';

/**
 * Index `asset_audits (tenant, client_id, started_at DESC)`.
 *
 * The table shipped with one index, `(tenant, started_at DESC)`, which serves
 * the tenant-wide list. The web surfaces added two client-keyed reads that it
 * cannot: the client drawer's Audits tab (every audit of one client, newest
 * first) and the command centre's Install base tile (the client's latest
 * completed audit). Both would otherwise scan the tenant's whole audit history.
 *
 * Index only — creating a table here would also have to be added to the tenant
 * deletion order, and server/src/test/unit/temporal/assetAuditTenantDeletionOrder.test.ts
 * reads that list out of the original create migration.
 *
 * Citus propagates CREATE INDEX to the shards; IF NOT EXISTS keeps a re-run a
 * no-op.
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('asset_audits'))) return;

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_asset_audits_tenant_client_started
    ON asset_audits (tenant, client_id, started_at DESC)
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('asset_audits'))) return;

  await knex.raw('DROP INDEX IF EXISTS idx_asset_audits_tenant_client_started');
};
