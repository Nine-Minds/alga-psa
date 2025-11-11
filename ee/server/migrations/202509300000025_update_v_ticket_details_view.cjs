/**
 * Drop v_ticket_details view as we're not using it yet.
 * This removes the view to allow for future schema changes without conflicts.
 *
 * This migration is idempotent: both up and down simply drop the view if present.
 *
 * @param { import("knex").Knex } knex
 */

exports.config = { transaction: false };

const VIEW_NAME = 'v_ticket_details';

const log = (message) => console.log(`[v_ticket_details] ${message}`);

async function dropViewIfExists(knex) {
  const { rows } = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_views
        WHERE viewname = ?
      ) AS exists
    `,
    [VIEW_NAME]
  );

  if (rows?.[0]?.exists) {
    await knex.raw(`DROP VIEW IF EXISTS ${VIEW_NAME} CASCADE`);
    log('Dropped existing view');
  } else {
    log('View not found; skipping drop');
  }
}

exports.up = async function up(knex) {
  // Drop the view as we're not using it yet
  log('Dropping v_ticket_details view...');
  await dropViewIfExists(knex);
  log('View dropped successfully');
};

exports.down = async function down(knex) {
  // Drop the view (same as up, since we're not using it yet)
  log('Dropping v_ticket_details view...');
  await dropViewIfExists(knex);
  log('View dropped successfully');
};
