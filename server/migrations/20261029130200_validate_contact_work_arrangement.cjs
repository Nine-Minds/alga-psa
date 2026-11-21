'use strict';

/**
 * Step 2 of 2 for contacts.work_arrangement (see 20261029130100_add_contact_work_arrangement).
 *
 * The CHECK was added NOT VALID, so it guards every write but was never scanned. Validating it
 * takes SHARE UPDATE EXCLUSIVE for one pass while reads and writes continue; the column was
 * introduced by the previous migration and every existing row is NULL, so the pass rejects nothing.
 *
 * Untransacted (the scan's lock is not held together with anything else) and re-runnable: a
 * constraint that is already validated, or absent because the pair was rolled back, is left alone.
 */

const CONSTRAINT = 'contacts_work_arrangement_check';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  const { rows } = await knex.raw(
    `SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = 'contacts'::regclass`,
    [CONSTRAINT]
  );

  if (rows.length === 0 || rows[0].convalidated) {
    return;
  }

  await knex.raw(`ALTER TABLE contacts VALIDATE CONSTRAINT ${CONSTRAINT}`);
};

exports.down = async function down() {
  // Nothing to undo: 20261029130100's down drops the constraint along with the column.
};
