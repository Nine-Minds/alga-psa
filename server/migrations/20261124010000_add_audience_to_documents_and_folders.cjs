/**
 * Documents and folders store an audience, backfilled from client visibility (S1).
 *
 * `documents.audience` and `document_folders.audience`: text NOT NULL DEFAULT
 * 'organization_private', checked against the comment-audience values
 * (`requester`, `shared_it`, `organization_private`). A constant default is a
 * metadata-only add; nothing is rewritten.
 *
 * Backfill, only rows still at the default (so a re-run touches nothing):
 *  - `is_client_visible = true`  -> `requester` (both tables);
 *  - documents that are not client-visible and whose author (`created_by`) holds a
 *    seat assignment -> `shared_it`. "Holds" is a `co_managed_seat_assignments` row
 *    in the same tenant with `user_id = documents.created_by` and `state <> 'revoked'`,
 *    the meaning `users.seat_reader` uses. Folders never become `shared_it`.
 *
 * Order: add column, backfill, Citus stale-local-heap cleanup, then the CHECK.
 * The CHECK goes in `NOT VALID` (ACCESS EXCLUSIVE only for the catalog change, under a
 * 2s lock_timeout with retry) and is validated right after in the same file, which
 * takes only SHARE UPDATE EXCLUSIVE and does not block writers. That is why the
 * migration is non-transactional rather than two files: the validation scan is the
 * only slow step, and it already runs outside the table lock.
 *
 * No trigger and no generated column here (S5 owns them). Idempotent; safe to re-run.
 */
const {
  canCreateDistributedTable,
  isDistributed,
  hasConstraint,
  inLockBoundedTransaction,
} = require('./utils/citusDistribution.cjs');

const TABLES = ['documents', 'document_folders'];
const AUDIENCES = ['requester', 'shared_it', 'organization_private'];
const checkName = (table) => `${table}_audience_check`;

// LEVERAGE: pattern citus-parent-heap-cleanup — copied from 20261010120000; the closure-checked truncate wants to live in citusDistribution.cjs.
/**
 * Truncate stranded pre-distribution rows from the coordinator heap, only when Citus is
 * installed, the table is distributed, the parent heap is non-empty and the whole
 * recursive FK closure is distributed (otherwise the cascading TRUNCATE would destroy a
 * local table's only copy; see the UNSAFE PATTERN notes in 20260718234058).
 */
async function cleanCitusParentHeap(knex, table) {
  if (!(await canCreateDistributedTable(knex))) return;
  if (!(await isDistributed(knex, table))) return;
  const size = await knex.raw('SELECT pg_relation_size(?::regclass) AS bytes', [table]);
  if (Number(size.rows?.[0]?.bytes ?? 0) <= 0) return;
  const closure = await knex.raw(`
    WITH RECURSIVE closure(oid) AS (
      SELECT ?::regclass::oid
      UNION
      SELECT CASE WHEN c.conrelid = k.oid THEN c.confrelid ELSE c.conrelid END
      FROM closure k
      JOIN pg_constraint c ON c.contype = 'f' AND (c.conrelid = k.oid OR c.confrelid = k.oid)
    )
    SELECT closure.oid::regclass::text AS name,
           EXISTS (SELECT 1 FROM pg_dist_partition p WHERE p.logicalrelid = closure.oid) AS distributed
    FROM closure`, [table]);
  const undistributed = closure.rows.filter((row) => !row.distributed).map((row) => row.name);
  if (undistributed.length > 0) {
    throw new Error(
      `[document-audience] refusing truncate_local_data_after_distributing_table: FK closure of ${table} `
      + `contains non-distributed tables (${undistributed.join(', ')})`,
    );
  }
  await knex.raw('SELECT truncate_local_data_after_distributing_table(?::regclass)', [table]);
}

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  const present = [];
  for (const table of TABLES) {
    if (await knex.schema.hasTable(table)) present.push(table);
  }

  for (const table of present) {
    await inLockBoundedTransaction(knex, (trx) => trx.raw(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'organization_private'`));
  }

  // migration-lint: allow 5 - one-shot backfill of the new constant-default column; guarded by audience = default so a re-run visits nothing, and only client-visible rows are touched
  if (present.includes('documents')) await knex.raw(`UPDATE documents SET audience = 'requester' WHERE audience = 'organization_private' AND is_client_visible = true`);
  // migration-lint: allow 5 - same one-shot, default-guarded backfill for folders
  if (present.includes('document_folders')) await knex.raw(`UPDATE document_folders SET audience = 'requester' WHERE audience = 'organization_private' AND is_client_visible = true`);

  if (present.includes('documents') && (await knex.schema.hasTable('co_managed_seat_assignments'))) {
    // Join on tenant so the statement stays colocated on Citus.
    // migration-lint: allow 5 - one-shot backfill; only default-audience, non-client-visible documents authored by a seat holder are touched, and seat holders are the paid exception rather than the tenant population
    await knex.raw(`UPDATE documents SET audience = 'shared_it'
      WHERE audience = 'organization_private' AND is_client_visible = false
        AND EXISTS (SELECT 1 FROM co_managed_seat_assignments sa
          WHERE sa.tenant = documents.tenant AND sa.user_id = documents.created_by AND sa.state <> 'revoked')`);
  }

  for (const table of present) {
    await cleanCitusParentHeap(knex, table);
    if (!(await hasConstraint(knex, table, checkName(table)))) {
      const list = AUDIENCES.map((a) => `'${a}'`).join(', ');
      await inLockBoundedTransaction(knex, (trx) => trx.raw(
        `ALTER TABLE ${table} ADD CONSTRAINT ${checkName(table)} CHECK (audience IN (${list})) NOT VALID`));
    }
    await knex.raw(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${checkName(table)}`);
  }
};

/** @param { import("knex").Knex } knex */
exports.down = async function down(knex) {
  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${checkName(table)}`);
    await knex.raw(`ALTER TABLE ${table} DROP COLUMN IF EXISTS audience`);
  }
};

// Lock-bounded DDL runs in its own transactions (inLockBoundedTransaction).
exports.config = { transaction: false };
