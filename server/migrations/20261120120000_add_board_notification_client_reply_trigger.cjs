/**
 * Board notification rules: "client replied on an unassigned ticket" trigger
 * (2026-11-20, alga-2026-0003350).
 *
 * Adds `notify_on_unassigned_client_reply` next to `notify_on_create` so a rule can fire when a
 * client replies to a ticket nobody owns. One subcommand per ALTER and no transaction (Citus
 * distributed table); hasColumn-guarded, so the migration is re-runnable.
 */
const TABLE = 'board_notification_rules';
const COLUMN = 'notify_on_unassigned_client_reply';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(TABLE, COLUMN))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} boolean NOT NULL DEFAULT false`);
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn(TABLE, COLUMN)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
  }
};

// Citus requires DDL on distributed tables outside a transaction block.
exports.config = { transaction: false };
