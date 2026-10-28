'use strict';

/**
 * alga-2026-0002799: let a tenant's custom domain serve the MSP app.
 *
 *   portal_domains.surface   client_portal | msp | both   (existing rows => client_portal)
 *
 * The per-tenant UNIQUE (tenant) constraint is replaced by UNIQUE (tenant, surface).
 * Domain uniqueness stays GLOBAL (portal_domains_domain_unique_idx on lower(domain) is
 * untouched), so one host still maps to exactly one tenant.
 *
 * Citus notes (see the citus-migration-gotchas skill):
 *  - The new unique constraint includes the distribution column (tenant), so it is legal
 *    on a tenant-distributed table.
 *  - If portal_domains is distributed, stale rows can remain in the coordinator-local heap
 *    and fail unique index builds with a duplicate no query can see. They are truncated
 *    (guarded by pg_dist_partition so CE / plain Postgres is unaffected) before the index
 *    is built.
 *  - `surface` is text + CHECK instead of a new enum type so nothing needs type propagation
 *    to workers. ADD COLUMN with a constant default is metadata-only and propagates.
 *  - The old constraint is looked up by definition rather than by name, because the name
 *    differs between environments (knex default vs. hand-created).
 */

const TABLE = 'portal_domains';
const NEW_CONSTRAINT = 'portal_domains_tenant_surface_unique';
const CHECK_CONSTRAINT = 'portal_domains_surface_check';

async function truncateStaleLocalHeapIfDistributed(knex) {
  const citus = await knex.raw("SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS has_citus");
  if (!citus.rows?.[0]?.has_citus) return;
  const distributed = await knex.raw(
    `SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'public.${TABLE}'::regclass`
  );
  if (distributed.rows.length > 0) {
    await knex.raw(`SELECT truncate_local_data_after_distributing_table('public.${TABLE}')`);
  }
}

async function findUniqueConstraintOnColumns(knex, columns) {
  const result = await knex.raw(
    `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE rel.relname = ? AND nsp.nspname = current_schema() AND con.contype = 'u'
        AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
               FROM unnest(con.conkey) k
               JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k) = ?::text[]`,
    [TABLE, `{${[...columns].sort().join(',')}}`]
  );
  return result.rows.map((r) => r.conname);
}

exports.up = async function up(knex) {
  await knex.raw(
    `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'client_portal'`
  );

  const hasCheck = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = '${TABLE}'::regclass`,
    [CHECK_CONSTRAINT]
  );
  if (hasCheck.rows.length === 0) {
    // migration-lint: allow 2 - retroactive: CHECK added under a pg_constraint absence probe on portal_domains, a small per-tenant table; merged before the lint existed
    await knex.raw(
      `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CHECK_CONSTRAINT} CHECK (surface IN ('client_portal', 'msp', 'both'))`
    );
  }

  await truncateStaleLocalHeapIfDistributed(knex);

  for (const name of await findUniqueConstraintOnColumns(knex, ['tenant'])) {
    // migration-lint: allow UNRESOLVED - constraint names come from findUniqueConstraintOnColumns (catalog lookup of tenant-only unique constraints); no literal exists to resolve
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT "${name}"`);
  }

  const hasNew = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = '${TABLE}'::regclass`,
    [NEW_CONSTRAINT]
  );
  if (hasNew.rows.length === 0) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${NEW_CONSTRAINT} UNIQUE (tenant, surface)`);
  }
};

exports.down = async function down(knex) {
  // Re-establishing UNIQUE (tenant) is only possible when each tenant has a single row.
  // Keep the earliest row per tenant (its surface is dropped with the column).
  await knex.raw(
    `DELETE FROM ${TABLE} p
      USING ${TABLE} q
      WHERE p.tenant = q.tenant AND (p.created_at, p.id) > (q.created_at, q.id)`
  );
  await truncateStaleLocalHeapIfDistributed(knex);
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${NEW_CONSTRAINT}`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${CHECK_CONSTRAINT}`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS surface`);
  await knex.raw(`ALTER TABLE ${TABLE} ADD CONSTRAINT portal_domains_tenant_unique UNIQUE (tenant)`);
};
