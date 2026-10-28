/** The audience is a live policy; existing definitions default to everyone. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('service_request_definitions', (table) => {
    table.jsonb('audience').notNullable().defaultTo(knex.raw(`'{"join":"and","clauses":[]}'::jsonb`));
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('service_request_definitions', (table) => table.dropColumn('audience'));
};
