/**
 * Board-level "Default watchlist" (alga-2026-0002379).
 *
 * Two columns on the already-distributed `boards` table (tenant is part of its
 * key, so no new distribution work is needed and Citus propagates the ALTER):
 *
 *   default_watchlist_enabled — boolean, NOT NULL, default false. The opt-in
 *                               switch. Existing boards stay off, so upgrading
 *                               changes no ticket's watchers.
 *
 *   default_watchlist         — JSONB, nullable: { "user_ids": [uuid], "emails": [text] }.
 *                               Internal users are stored by id (their address
 *                               is resolved when a ticket is created, so a
 *                               changed or deactivated user is honoured);
 *                               free-form addresses are stored normalised.
 *                               Kept separate from the switch so an admin can
 *                               disable the watchlist without losing the list.
 *
 * Why not a new table: the recipients are a small, board-owned document that is
 * only ever read whole and written whole — the same shape as
 * `list_view_settings` on this table. A join table would add a Citus-distributed
 * relation, FK handling on user deletion, and a second read per ticket for no
 * query that needs it. The ticket side reuses the existing
 * `tickets.attributes.watch_list` mechanism, so nothing new is stored there.
 *
 * One subcommand per ALTER: Citus rejects an ALTER carrying two utility
 * subcommands ("cannot execute multiple utility events").
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('boards', 'default_watchlist_enabled'))) {
    await knex.schema.alterTable('boards', (table) => {
      table.boolean('default_watchlist_enabled').notNullable().defaultTo(false);
    });
  }

  if (!(await knex.schema.hasColumn('boards', 'default_watchlist'))) {
    await knex.schema.alterTable('boards', (table) => {
      table.jsonb('default_watchlist').nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('boards', 'default_watchlist')) {
    await knex.schema.alterTable('boards', (table) => {
      table.dropColumn('default_watchlist');
    });
  }

  if (await knex.schema.hasColumn('boards', 'default_watchlist_enabled')) {
    await knex.schema.alterTable('boards', (table) => {
      table.dropColumn('default_watchlist_enabled');
    });
  }
};
