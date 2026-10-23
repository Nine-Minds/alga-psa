/**
 * A system actor for asset history (FR-C2 / FR-C9).
 *
 * `asset_history.changed_by` has always been NOT NULL, so the one caller with
 * no session — RMM sync — could not describe what it had just done. Every
 * Level.io or Tanium auto-assignment wrote an `asset_assignments` row and no
 * timeline entry at all, and "Auto-assigned to Jane from Level.io" never
 * appeared on the device whose owner had just changed.
 *
 * The column becomes nullable; history reads already left-join `users`, so a
 * row with no actor simply has no name beside it.
 */

exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE asset_history ALTER COLUMN changed_by DROP NOT NULL');
};

exports.down = async function down(knex) {
  // Rows written by sync have no user to attribute them to, so they go rather
  // than block the rollback.
  await knex.raw('DELETE FROM asset_history WHERE changed_by IS NULL');
  await knex.raw('ALTER TABLE asset_history ALTER COLUMN changed_by SET NOT NULL');
};
