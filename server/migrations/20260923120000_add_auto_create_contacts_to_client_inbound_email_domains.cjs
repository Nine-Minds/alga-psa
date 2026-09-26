exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('client_inbound_email_domains'))) return;
  if (!(await knex.schema.hasColumn('client_inbound_email_domains', 'auto_create_contacts'))) {
    await knex.schema.alterTable('client_inbound_email_domains', (table) => {
      table.boolean('auto_create_contacts').notNullable().defaultTo(false);
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('client_inbound_email_domains', 'auto_create_contacts')) {
    await knex.schema.alterTable('client_inbound_email_domains', (table) => table.dropColumn('auto_create_contacts'));
  }
};

exports.config = { transaction: false };
