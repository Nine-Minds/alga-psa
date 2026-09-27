'use strict';

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('contract_template_discount_copies')) return;
  await knex.schema.createTable('contract_template_discount_copies', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('client_contract_id').notNullable();
    table.string('template_discount_key', 200).notNullable();
    table.uuid('discount_id').notNullable();
    table.primary(['tenant', 'client_contract_id', 'template_discount_key']);
    table.unique(['tenant', 'discount_id']);
    table.foreign(['tenant', 'client_contract_id']).references(['tenant', 'client_contract_id']).inTable('client_contracts').onDelete('CASCADE');
    table.foreign(['tenant', 'discount_id']).references(['tenant', 'discount_id']).inTable('discounts').onDelete('CASCADE');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_template_discount_copies');
};
