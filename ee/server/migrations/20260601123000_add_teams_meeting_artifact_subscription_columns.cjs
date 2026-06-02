const COLUMNS = [
  {
    name: 'recordings_subscription_id',
    add(table) {
      table.text('recordings_subscription_id').nullable();
    },
  },
  {
    name: 'recordings_subscription_expires_at',
    add(table) {
      table.timestamp('recordings_subscription_expires_at', { useTz: true }).nullable();
    },
  },
  {
    name: 'transcripts_subscription_id',
    add(table) {
      table.text('transcripts_subscription_id').nullable();
    },
  },
  {
    name: 'transcripts_subscription_expires_at',
    add(table) {
      table.timestamp('transcripts_subscription_expires_at', { useTz: true }).nullable();
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
