'use strict';

/**
 * document_upload_sessions — the target entity becomes optional (alga-2026-0002891).
 *
 * The document library and a task that is not saved yet upload a document with no target, which
 * `uploadDocument` has always allowed. The session carries the same: both columns null, or both set,
 * and a CHECK constraint holds that rule in the database.
 *
 * Expand-only: DROP NOT NULL is a catalog change with no rewrite or scan. The CHECK is added
 * NOT VALID, so the ALTER takes no scan under its lock; a NOT VALID check is still enforced on
 * every new or updated row. 20261112110100 validates it in its own non-transactional file.
 *
 * Idempotent: an already-present constraint is left alone, so a re-run never un-validates it.
 */

const TABLE = 'document_upload_sessions';
const CHECK = 'document_upload_sessions_target_both_or_neither';

async function hasConstraint(knex, name) {
  const { rows } = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`,
    [name, TABLE]
  );
  return rows.length > 0;
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN entity_type DROP NOT NULL`);
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN entity_id DROP NOT NULL`);
  if (!(await hasConstraint(knex, CHECK))) {
    await knex.raw(
      `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CHECK} CHECK ((entity_type IS NULL) = (entity_id IS NULL)) NOT VALID`
    );
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${CHECK}`);
  await knex(TABLE).whereNull('entity_type').orWhereNull('entity_id').del();
  await knex.schema.alterTable(TABLE, (table) => {
    table.text('entity_type').notNullable().alter();
    table.uuid('entity_id').notNullable().alter();
  });
};
