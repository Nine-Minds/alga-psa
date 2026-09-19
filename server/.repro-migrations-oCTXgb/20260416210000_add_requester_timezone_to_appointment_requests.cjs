exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('appointment_requests', 'requester_timezone');
  if (!hasColumn) {
    await knex.schema.alterTable('appointment_requests', (table) => {
      table.text('requester_timezone').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('appointment_requests', 'requester_timezone');
  if (hasColumn) {
    await knex.schema.alterTable('appointment_requests', (table) => {
      table.dropColumn('requester_timezone');
    });
  }
};
