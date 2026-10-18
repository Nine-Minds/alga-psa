const TABLE = 'accounting_export_artifacts';

exports.up = async function up(knex) {
  if (await knex.schema.hasTable(TABLE)) {
    const hasColumn = await knex.schema.hasColumn(TABLE, 'committed');
    if (!hasColumn) {
      await knex.schema.alterTable(TABLE, (table) => {
        // Existing persisted artifacts predate the visibility gate and were only
        // written after successful execution; preserve their availability.
        table.boolean('committed').notNullable().defaultTo(true);
      });
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable(TABLE) && await knex.schema.hasColumn(TABLE, 'committed')) {
    await knex.schema.alterTable(TABLE, (table) => table.dropColumn('committed'));
  }
};
