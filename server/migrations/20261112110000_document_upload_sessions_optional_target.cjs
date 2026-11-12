'use strict';

/**
 * document_upload_sessions — the target entity becomes optional (alga-2026-0002891).
 *
 * The document library and a task that is not saved yet upload a document with no target, which
 * `uploadDocument` has always allowed. The session carries the same: both columns null, or both set.
 */

const TABLE = 'document_upload_sessions';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  await knex.schema.alterTable(TABLE, (table) => {
    table.text('entity_type').nullable().alter();
    table.uuid('entity_id').nullable().alter();
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  await knex(TABLE).whereNull('entity_type').orWhereNull('entity_id').del();
  await knex.schema.alterTable(TABLE, (table) => {
    table.text('entity_type').notNullable().alter();
    table.uuid('entity_id').notNullable().alter();
  });
};
