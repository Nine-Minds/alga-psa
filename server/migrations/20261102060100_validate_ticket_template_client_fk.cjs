'use strict';

/**
 * Step 2 of the client-scoped ticket templates change (20261102060000 adds the column and the
 * NOT VALID foreign key). Validating takes SHARE UPDATE EXCLUSIVE and scans only non-NULL
 * client_id values — there are none when this runs — so reads and writes continue. Idempotent, and
 * a no-op when the FK was skipped because the tables are not co-located.
 */

const TABLE = 'ticket_templates';
const FK_NAME = `${TABLE}_client_foreign`;

exports.up = async function up(knex) {
  const existing = await knex.raw(
    'SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [FK_NAME, TABLE]
  );
  if (!existing.rows?.length || existing.rows[0].convalidated) return;
  await knex.raw(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT ${FK_NAME}`);
};

exports.down = async function down() {
  // Forward-only: a validated constraint is not un-validated.
};

exports.config = { transaction: false };
