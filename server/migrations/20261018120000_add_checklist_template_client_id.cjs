'use strict';

/**
 * Client-scoped checklist templates.
 *
 *   checklist_templates.client_id uuid NULL   null = tenant-wide (every existing row; no backfill)
 *   index (tenant, client_id)
 *   FK (tenant, client_id) -> clients (tenant, client_id)   ON DELETE NO ACTION
 *
 * Why NO ACTION and not SET NULL: docs/AI_coding_standards.md says ON DELETE SET NULL is not
 * supported on Citus and is handled in the application. A plain SET NULL on the composite
 * (tenant, client_id) key would also null `tenant`, and the column-list form
 * `SET NULL (client_id)` is not something this repo relies on. deleteClient therefore deactivates
 * the client's scoped templates and detaches them (client_id = NULL) in the same transaction
 * BEFORE deleting the client, so a deleted client never leaves a live template widened to every
 * client. Tenant deletion already removes checklist_templates before clients.
 *
 * Citus: the FK includes the distribution column and is only added when both tables are
 * co-located (same pattern as 20261017120000), otherwise skipped with a warning.
 */

const TABLE = 'checklist_templates';
const FK_NAME = `${TABLE}_client_foreign`;
const INDEX_NAME = `idx_${TABLE}_tenant_client`;

async function colocationOf(knex, tableName) {
  const citus = await knex.raw("SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS has_citus");
  if (!citus.rows?.[0]?.has_citus) return { citus: false, colocationId: null };
  const result = await knex.raw(
    'SELECT colocationid FROM pg_dist_partition WHERE logicalrelid = ?::regclass',
    [tableName]
  );
  return { citus: true, colocationId: result.rows?.[0]?.colocationid ?? null };
}

exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS client_id uuid NULL`);
  // migration-lint: allow 1 - retroactive: index on checklist_templates added in the same migration that adds the nullable client_id column; merged before the lint existed
  await knex.raw(`CREATE INDEX IF NOT EXISTS ${INDEX_NAME} ON ${TABLE} (tenant, client_id)`);

  const existing = await knex.raw(
    'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [FK_NAME, TABLE]
  );
  if (existing.rows?.length) return;

  const [templates, clients] = await Promise.all([colocationOf(knex, TABLE), colocationOf(knex, 'clients')]);
  const bothColocated = !templates.citus || (templates.colocationId !== null && templates.colocationId === clients.colocationId);
  if (bothColocated) {
    // MATCH SIMPLE: rows with a NULL client_id are not checked.
    // migration-lint: allow 2 - retroactive: FK on the just-added all-NULL client_id column, so validating it scans no referencing values; guarded by a pg_constraint probe
    await knex.raw(
      `ALTER TABLE ${TABLE} ADD CONSTRAINT ${FK_NAME}
       FOREIGN KEY (tenant, client_id) REFERENCES clients (tenant, client_id)`
    );
  } else {
    console.warn(`[${FK_NAME}] skipped: ${TABLE} and clients are not co-located distributed tables`);
  }
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${FK_NAME}`);
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS client_id`);
};

// No wrapping transaction (Citus DDL on distributed tables), as with the sibling migrations.
exports.config = { transaction: false };
