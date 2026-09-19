'use strict';

exports.up = async function up(knex) {
  await knex.schema.alterTable('opportunity_settings', (table) => {
    table.specificType('assessment_service_ids', 'uuid[]')
      .notNullable()
      .defaultTo(knex.raw("'{}'::uuid[]"));
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('opportunity_settings', (table) => {
    table.dropColumn('assessment_service_ids');
  });
};
