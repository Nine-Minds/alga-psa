const COLUMNS = [
  {
    name: 'default_meeting_organizer_object_id',
    add(table) {
      table.text('default_meeting_organizer_object_id').nullable();
    },
  },
  {
    name: 'download_recordings',
    add(table) {
      table.boolean('download_recordings').notNullable().defaultTo(false);
    },
  },
  {
    name: 'expose_recordings_in_portal',
    add(table) {
      table.boolean('expose_recordings_in_portal').notNullable().defaultTo(false);
    },
  },
];

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('teams_integrations');
  if (!hasTable) {
    return;
  }

  for (const column of COLUMNS) {
    const hasColumn = await knex.schema.hasColumn('teams_integrations', column.name);
    if (!hasColumn) {
      await knex.schema.alterTable('teams_integrations', (table) => {
        column.add(table);
      });
    }
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('teams_integrations');
  if (!hasTable) {
    return;
  }

  for (const column of [...COLUMNS].reverse()) {
    const hasColumn = await knex.schema.hasColumn('teams_integrations', column.name);
    if (hasColumn) {
      await knex.schema.alterTable('teams_integrations', (table) => {
        table.dropColumn(column.name);
      });
    }
  }
};
