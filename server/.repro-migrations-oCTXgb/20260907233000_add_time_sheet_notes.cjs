exports.up = async function(knex) {
  if (!await knex.schema.hasColumn('time_sheets', 'notes')) {
    await knex.schema.alterTable('time_sheets', table => table.text('notes').nullable());
  }
};

exports.down = async function(knex) {
  if (!await knex.schema.hasColumn('time_sheets', 'notes')) return;
  if (await knex('time_sheets').whereNotNull('notes').first('id')) {
    throw new Error('Cannot discard retained timesheet notes; export or reconcile them before rollback');
  }
  await knex.schema.alterTable('time_sheets', table => table.dropColumn('notes'));
};
