/**
 * Renumber standard_statuses.display_order to be unique and gapless within each
 * item_type (1..N ordered by current display_order, then name). Legacy installs
 * carried duplicate display_orders that broke board/project status seeding into
 * the per-board `statuses` unique index. All rows are kept; idempotent.
 */
exports.up = async function(knex) {
  console.log('Starting migration: dedupe_standard_status_display_order');

  const rows = await knex('standard_statuses')
    .select('standard_status_id', 'item_type', 'display_order', 'name')
    .orderBy([
      { column: 'item_type', order: 'asc' },
      { column: 'display_order', order: 'asc' },
      { column: 'name', order: 'asc' },
    ]);

  const nextOrderByType = {};
  let updated = 0;

  for (const row of rows) {
    const next = (nextOrderByType[row.item_type] || 0) + 1;
    nextOrderByType[row.item_type] = next;

    if (row.display_order !== next) {
      await knex('standard_statuses')
        .where({ standard_status_id: row.standard_status_id })
        .update({ display_order: next });
      updated++;
    }
  }

  console.log(
    `Renumbered ${updated} standard_statuses row(s) across ${Object.keys(nextOrderByType).length} item type(s)`
  );
  console.log('Migration completed successfully');
};

exports.down = async function() {
  // Not reversible: original duplicate ordering is not recoverable.
  console.log('Rollback skipped: standard_statuses display_order normalization is not reversible');
};
