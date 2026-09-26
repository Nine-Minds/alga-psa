exports.up = async function(knex) {
  await knex.schema.alterTable('microsoft_email_provider_config', (table) => {
    table.jsonb('last_callback_diagnostic').nullable();
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('microsoft_email_provider_config', (table) => {
    table.dropColumn('last_callback_diagnostic');
  });
};
