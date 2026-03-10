exports.up = async function up(knex) {
  console.log('Dropping legacy contacts.phone_number column...');

  const hasPhoneNumberColumn = await knex.schema.hasColumn('contacts', 'phone_number');
  if (hasPhoneNumberColumn) {
    await knex.schema.alterTable('contacts', (table) => {
      table.dropColumn('phone_number');
    });
  }

  console.log('Legacy contacts.phone_number column dropped.');
};

exports.down = async function down(knex) {
  console.log('Restoring legacy contacts.phone_number column...');

  const hasPhoneNumberColumn = await knex.schema.hasColumn('contacts', 'phone_number');
  if (!hasPhoneNumberColumn) {
    await knex.schema.alterTable('contacts', (table) => {
      table.text('phone_number');
    });
  }

  console.log('Legacy contacts.phone_number column restored.');
};
