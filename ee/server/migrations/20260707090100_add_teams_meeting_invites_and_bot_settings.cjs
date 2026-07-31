const INTEGRATION_COLUMNS = [
  {
    name: 'send_meeting_invites',
    add(table) {
      // Default on: generated meetings send native calendar invites to attendees.
      table.boolean('send_meeting_invites').notNullable().defaultTo(true);
    },
  },
  {
    name: 'notification_channels',
    add(table) {
      // Per-category delivery channel preference: { "<category>": "activity_feed" | "bot_dm" | "both" }.
      // Absent categories default to activity_feed.
      table.jsonb('notification_channels').nullable();
    },
  },
];

const CONVERSATION_REFERENCE_COLUMNS = [
  {
    name: 'context',
    add(table) {
      // Last-listed entities for ordinal bot references: { items: [{entityType, id, displayId?}], listedAt }.
      table.jsonb('context').nullable();
    },
  },
  {
    name: 'context_expires_at',
    add(table) {
      table.timestamp('context_expires_at', { useTz: true }).nullable();
    },
  },
];

async function addMissingColumns(knex, tableName, columns) {
  const hasTable = await knex.schema.hasTable(tableName);
  if (!hasTable) {
    return;
  }

  for (const column of columns) {
    const hasColumn = await knex.schema.hasColumn(tableName, column.name);
    if (!hasColumn) {
      await knex.schema.alterTable(tableName, (table) => {
        column.add(table);
      });
    }
  }
}

async function dropColumns(knex, tableName, columns) {
  const hasTable = await knex.schema.hasTable(tableName);
  if (!hasTable) {
    return;
  }

  for (const column of [...columns].reverse()) {
    const hasColumn = await knex.schema.hasColumn(tableName, column.name);
    if (hasColumn) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropColumn(column.name);
      });
    }
  }
}

exports.up = async function up(knex) {
  await addMissingColumns(knex, 'teams_integrations', INTEGRATION_COLUMNS);
  await addMissingColumns(knex, 'teams_conversation_references', CONVERSATION_REFERENCE_COLUMNS);
};

exports.down = async function down(knex) {
  await dropColumns(knex, 'teams_conversation_references', CONVERSATION_REFERENCE_COLUMNS);
  await dropColumns(knex, 'teams_integrations', INTEGRATION_COLUMNS);
};
