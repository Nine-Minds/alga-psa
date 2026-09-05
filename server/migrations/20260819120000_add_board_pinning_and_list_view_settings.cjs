/**
 * Board-level view configuration: pinning + a per-board list view document.
 *
 * Two columns, deliberately shaped differently:
 *
 *   is_pinned          — a real boolean column. It is queried and joined (only
 *                        pinned boards get a tab), it is one bit, and it has no
 *                        internal structure. A column is the right shape.
 *
 *   list_view_settings — a JSONB document holding the board's default ticket-list
 *                        view (column visibility + order, density, captured
 *                        filters incl. sort). NOT wide columns: the same document
 *                        already exists one layer up at
 *                        tenant_settings.ticket_display_settings.list, and a
 *                        second representation here would mean two shapes for one
 *                        concept plus a translator between them — which is exactly
 *                        the history of the eleven dead display_* columns on this
 *                        table. NULL means "inherit the tenant default"; reset
 *                        writes NULL rather than {} so "unset" and "empty" stay
 *                        distinguishable.
 *
 * Backfill: every currently-active board is pinned, so the tab strip looks
 * exactly as it does today on upgrade and admins curate DOWN from there rather
 * than arriving at an empty strip and having to rebuild it.
 *
 * No index on (tenant, is_pinned): board counts per tenant are small and
 * getAllBoards already reads the whole set unfiltered, so an index would be
 * write cost for a scan that never happens.
 */

exports.up = async function up(knex) {
  const hasIsPinned = await knex.schema.hasColumn('boards', 'is_pinned');
  const hasListViewSettings = await knex.schema.hasColumn('boards', 'list_view_settings');

  // One subcommand per ALTER: Citus rejects an ALTER carrying two utility
  // subcommands with "cannot execute multiple utility events".
  if (!hasIsPinned) {
    await knex.schema.alterTable('boards', (table) => {
      table.boolean('is_pinned').notNullable().defaultTo(false);
    });
  }

  if (!hasListViewSettings) {
    await knex.schema.alterTable('boards', (table) => {
      table.jsonb('list_view_settings').nullable();
    });
  }

  if (!hasIsPinned) {
    // Only on first install of the column — re-running must not re-pin boards an
    // admin has since unpinned.
    await knex('boards').where({ is_inactive: false }).update({ is_pinned: true });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('boards', 'list_view_settings')) {
    await knex.schema.alterTable('boards', (table) => {
      table.dropColumn('list_view_settings');
    });
  }

  if (await knex.schema.hasColumn('boards', 'is_pinned')) {
    await knex.schema.alterTable('boards', (table) => {
      table.dropColumn('is_pinned');
    });
  }
};
