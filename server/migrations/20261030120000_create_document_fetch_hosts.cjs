'use strict';

/**
 * document_fetch_hosts: a tenant's overrides to the platform's download-host allowlist
 * for URL document sources (POST /api/v1/documents).
 *
 *   effective allowlist = built-in hosts (in code) - rows of kind 'builtin_disabled'
 *                         + rows of kind 'custom'
 *
 * Built-in hosts are NOT seeded here; they live in code
 * (server/src/lib/api/services/documents/fetchHosts.ts).
 *
 * Citus: new table, distributed on `tenant` colocated with `tenants` (no-op on plain
 * Postgres). Every unique index includes `tenant` and is created after distribution.
 * Like the other post-Citus tenant tables it carries no RLS policy; access goes through
 * tenantDb, which scopes every query by tenant. No foreign keys: `created_by` is a
 * historical reference and must survive user deletion.
 * create_distributed_table cannot run in a transaction block, hence `transaction: false`;
 * every step is idempotent.
 *
 * Also reconciles the new `document:manage_fetch_hosts` permission (declared in the unified
 * catalog, server/migrations/utils/permissions/catalog.cjs) into every existing tenant and
 * grants it to the MSP Admin role. New tenants get it from the onboarding permission seed,
 * which reads the same catalog. `document:create` does not imply it.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

const TABLE = 'document_fetch_hosts';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('entry_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('kind').notNullable();
      table.text('host_pattern').notNullable();
      table.text('note').nullable();
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'entry_id']);
    });

    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${TABLE}_kind_check
      CHECK (kind IN ('custom', 'builtin_disabled'))
    `);
  }

  await ensureTenantDistribution(knex, TABLE);

  // The unique index doubles as the fetch-time lookup (leading column `tenant`).
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${TABLE}_tenant_kind_host_unique
    ON ${TABLE} (tenant, kind, host_pattern)
  `);

  // migration-lint: allow 8 - reconcileAllTenants is the repo-standard, additive, per-tenant-idempotent way to provision a catalog permission (server/migrations/utils/permissions/README.md, "Adding a permission"); document:manage_fetch_hosts is declared in catalog.cjs
  await reconcileAllTenants(knex, { label: 'create_document_fetch_hosts' });
};

exports.down = async function down(knex) {
  // The permission is left in place on purpose: removing a permission may delete state
  // tenants assigned to custom roles (see server/migrations/utils/permissions/README.md).
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };
