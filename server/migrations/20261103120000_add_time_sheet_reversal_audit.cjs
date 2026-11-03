exports.up = async function (knex) {
  const columns = [
    ['reversal_reason', (table) => table.text('reversal_reason').nullable()],
    ['reversed_at', (table) => table.timestamp('reversed_at').nullable()],
    ['reversed_by', (table) => table.uuid('reversed_by').nullable()],
  ];
  for (const [column, add] of columns) {
    if (!(await knex.schema.hasColumn('time_sheets', column))) {
      await knex.schema.alterTable('time_sheets', add);
    }
  }
};

exports.down = async function (knex) {
  const columns = ['reversed_by', 'reversed_at', 'reversal_reason'];
  for (const column of columns) {
    if (await knex.schema.hasColumn('time_sheets', column)) {
      await knex.schema.alterTable('time_sheets', (table) => table.dropColumn(column));
    }
  }
};
