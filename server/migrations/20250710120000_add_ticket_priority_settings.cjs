const { Knex } = require('knex');

exports.up = async function(knex) {
  await knex.schema.createTable('ticket_priority_settings', table => {
    table.uuid('tenant').notNullable();
    table.boolean('use_priority_matrix').notNullable().defaultTo(false);
    table.jsonb('priority_matrix').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant']);
    table.foreign('tenant').references('tenant').inTable('tenants');
  });

  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    await knex('ticket_priority_settings').insert({ tenant });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('ticket_priority_settings');
};
