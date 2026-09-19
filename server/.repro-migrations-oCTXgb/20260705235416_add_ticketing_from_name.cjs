
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenant_email_settings');
  if (!hasTable) {
    console.log('tenant_email_settings table missing - skipping ticketing from name migration');
    return;
  }

  const hasColumn = await knex.schema.hasColumn('tenant_email_settings', 'ticketing_from_name');
  if (hasColumn) {
    console.log('ticketing_from_name column already exists - skipping');
    return;
  }

  await knex.schema.alterTable('tenant_email_settings', (table) => {
    table.string('ticketing_from_name');
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenant_email_settings');
  if (!hasTable) {
    return;
  }

  const hasColumn = await knex.schema.hasColumn('tenant_email_settings', 'ticketing_from_name');
  if (!hasColumn) {
    return;
  }

  await knex.schema.alterTable('tenant_email_settings', (table) => {
    table.dropColumn('ticketing_from_name');
  });
};
