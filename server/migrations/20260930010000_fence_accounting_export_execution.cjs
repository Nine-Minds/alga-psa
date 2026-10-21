exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('accounting_export_batches', 'execution_id'))) {
    await knex.schema.alterTable('accounting_export_batches', (table) => {
      table.uuid('execution_id').nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('accounting_export_batches', 'execution_id')) {
    await knex.schema.alterTable('accounting_export_batches', (table) => {
      table.dropColumn('execution_id');
    });
  }
};
