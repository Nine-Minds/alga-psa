/** The audience is a live policy; existing definitions default to everyone. */
exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('service_request_definitions', 'audience_mode')) {
    throw new Error('Revision-1 service request audience schema exists; preserve its data and remove the legacy schema before applying this migration');
  }
  if (!(await knex.schema.hasColumn('service_request_definitions', 'audience'))) {
    await knex.schema.alterTable('service_request_definitions', (table) => {
      table.jsonb('audience').notNullable().defaultTo(knex.raw(`'{"join":"and","clauses":[]}'::jsonb`));
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('service_request_definitions', (table) => table.dropColumn('audience'));
};
