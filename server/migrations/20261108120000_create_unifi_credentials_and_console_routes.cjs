/**
 * UniFi: multiple API keys per integration.
 *
 * - unifi_credentials: one row per key (Site Manager or local controller) with
 *   its own lifecycle state. The key itself stays in the secret provider under
 *   `unifi_api_key:<credential_id>` (and `unifi_local_base_url:<credential_id>`
 *   for local mode); nothing secret is stored here.
 * - unifi_console_routes: which credential reaches which console. One row per
 *   console, keyed (tenant, integration_id, host_id).
 * - Backfill: one 'Default' credential per existing UniFi integration. The mode
 *   is copied from settings.connectionMode and a local credential keeps host id
 *   'local', so every existing `local:<siteId>` scope key and asset mapping stays
 *   valid. No route rows are backfilled; the first sync writes them.
 *
 * A migration cannot read the secret provider (see
 * 20261104120000_purge_tenant_email_settings_local_heap.cjs for the precedent),
 * so the backfilled row is flagged `adopts_legacy_secret`. The first read of that
 * credential copies the legacy `unifi_api_key` / `unifi_local_base_url` secrets to
 * the per-credential names and clears the flag. The legacy secrets are left in
 * place for one release and removed by a follow-up migration/script.
 *
 * Citus: both tables are distributed on `tenant`, colocated with
 * rmm_integrations when that table is itself distributed (same rule as
 * 20261103120000_create_rmm_condition_lifecycle.cjs). No now() inside
 * CASE/COALESCE. Idempotent: safe to re-run and safe on a tenant with no UniFi
 * integration.
 */
const { canCreateDistributedTable, isDistributed } = require('./utils/citusDistribution.cjs');

// LEVERAGE: friction migration-secret-access — migrations cannot read the secret provider, so credentials carry an adopts_legacy_secret flag and adopt lazily at first read; a migration-time secret hook would remove the flag.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('unifi_credentials'))) {
    await knex.schema.createTable('unifi_credentials', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('credential_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('integration_id').notNullable();
      table.text('label').notNullable();
      table.text('mode').notNullable();
      table.text('local_host_id').nullable();
      table.text('status').notNullable().defaultTo('active');
      table.text('last_error').nullable();
      table.timestamp('last_checked_at', { useTz: true }).nullable();
      table.boolean('adopts_legacy_secret').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'credential_id']);
      table
        .foreign(['tenant', 'integration_id'])
        .references(['tenant', 'integration_id'])
        .inTable('rmm_integrations')
        .onDelete('CASCADE');
      table.index(['tenant', 'integration_id', 'status'], 'idx_unifi_credentials_status');
    });
    await knex.raw(
      "ALTER TABLE unifi_credentials ADD CONSTRAINT unifi_credentials_mode_check CHECK (mode IN ('site_manager', 'local'))"
    );
    await knex.raw(
      "ALTER TABLE unifi_credentials ADD CONSTRAINT unifi_credentials_status_check CHECK (status IN ('active', 'reconnect_required', 'disabled'))"
    );
    // Label uniqueness is per integration and case-insensitive.
    await knex.raw(
      'CREATE UNIQUE INDEX uq_unifi_credentials_label ON unifi_credentials (tenant, integration_id, lower(label))'
    );
    // A local host id names one controller; it is what scope keys are built from.
    await knex.raw(
      'CREATE UNIQUE INDEX uq_unifi_credentials_local_host ON unifi_credentials (tenant, integration_id, local_host_id) WHERE local_host_id IS NOT NULL'
    );
  }

  if (!(await knex.schema.hasTable('unifi_console_routes'))) {
    await knex.schema.createTable('unifi_console_routes', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('integration_id').notNullable();
      table.text('host_id').notNullable();
      // The owner. NULL only while state = 'unreachable' (no key reaches it).
      table.uuid('credential_id').nullable();
      table.text('console_name').nullable();
      table.text('state').notNullable().defaultTo('routed');
      table.text('last_error').nullable();
      table.timestamp('first_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('last_verified_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'integration_id', 'host_id']);
      table
        .foreign(['tenant', 'integration_id'])
        .references(['tenant', 'integration_id'])
        .inTable('rmm_integrations')
        .onDelete('CASCADE');
      table.index(['tenant', 'credential_id'], 'idx_unifi_console_routes_credential');
    });
    await knex.raw(
      "ALTER TABLE unifi_console_routes ADD CONSTRAINT unifi_console_routes_state_check CHECK (state IN ('routed', 'unreachable'))"
    );
    await knex.raw(
      "ALTER TABLE unifi_console_routes ADD CONSTRAINT unifi_console_routes_owner_check CHECK (state <> 'routed' OR credential_id IS NOT NULL)"
    );
  }

  // Follow the parent's actual topology: Citus can be installed while RMM tables
  // remain coordinator-local, and colocating with a local parent would fail.
  if ((await canCreateDistributedTable(knex)) && (await isDistributed(knex, 'rmm_integrations'))) {
    for (const name of ['unifi_credentials', 'unifi_console_routes']) {
      if (!(await isDistributed(knex, name))) {
        await knex.raw(`SELECT create_distributed_table('${name}', 'tenant', colocate_with => 'rmm_integrations')`);
      }
    }
  }

  // Route -> credential FK. Added after distribution so both sides share a
  // topology; skipped (like the other composite FKs here) if they ever differ.
  const fkPresent = await knex.raw(
    "SELECT 1 FROM pg_constraint WHERE conname = 'unifi_console_routes_tenant_credential_id_foreign' AND conrelid = 'unifi_console_routes'::regclass"
  );
  if (fkPresent.rows.length === 0) {
    const sameTopology =
      !(await canCreateDistributedTable(knex)) ||
      (await isDistributed(knex, 'unifi_credentials')) === (await isDistributed(knex, 'unifi_console_routes'));
    if (sameTopology) {
      await knex.raw(
        `ALTER TABLE unifi_console_routes
           ADD CONSTRAINT unifi_console_routes_tenant_credential_id_foreign
           FOREIGN KEY (tenant, credential_id) REFERENCES unifi_credentials (tenant, credential_id) ON DELETE CASCADE`
      );
    }
  }

  // Backfill one 'Default' credential per existing UniFi integration that has
  // none yet. Plain INSERT ... SELECT with a NOT EXISTS guard: re-runnable, and a
  // no-op when no UniFi integration exists.
  await knex.raw(
    `INSERT INTO unifi_credentials
       (tenant, credential_id, integration_id, label, mode, local_host_id, status, adopts_legacy_secret, created_at, updated_at)
     SELECT i.tenant,
            gen_random_uuid(),
            i.integration_id,
            'Default',
            CASE WHEN i.settings->>'connectionMode' = 'local' THEN 'local' ELSE 'site_manager' END,
            CASE WHEN i.settings->>'connectionMode' = 'local' THEN 'local' ELSE NULL END,
            'active',
            true,
            i.created_at,
            i.created_at
       FROM rmm_integrations i
      WHERE i.provider = 'unifi'
        AND NOT EXISTS (
          SELECT 1 FROM unifi_credentials c
           WHERE c.tenant = i.tenant AND c.integration_id = i.integration_id
        )`
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('unifi_console_routes');
  await knex.schema.dropTableIfExists('unifi_credentials');
};
