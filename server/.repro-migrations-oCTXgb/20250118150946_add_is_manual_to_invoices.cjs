exports.up = async function(knex) {
  await knex.schema.alterTable('invoices', (table) => {
    table.boolean('is_manual').notNullable().defaultTo(false);
  });

  // Update existing manual invoices - identify them by checking if they have no billing_cycle_id
  // and were created through the manual invoice process
  await knex('invoices')
    .whereNull('billing_cycle_id')
    .update({ is_manual: true });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('invoices', (table) => {
    table.dropColumn('is_manual');
  });
};
