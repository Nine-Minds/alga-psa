exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('teams_integrations', 'default_meeting_organizer_upn');

  if (!hasColumn) {
    await knex.schema.alterTable('teams_integrations', (table) => {
      table.text('default_meeting_organizer_upn').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('teams_integrations', 'default_meeting_organizer_upn');

  if (hasColumn) {
    await knex.schema.alterTable('teams_integrations', (table) => {
      table.dropColumn('default_meeting_organizer_upn');
    });
  }
};
