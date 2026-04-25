exports.up = async function up(knex) {
  const hasProviderColumn = await knex.schema.hasColumn('appointment_requests', 'online_meeting_provider');
  const hasUrlColumn = await knex.schema.hasColumn('appointment_requests', 'online_meeting_url');
  const hasIdColumn = await knex.schema.hasColumn('appointment_requests', 'online_meeting_id');

  if (!hasProviderColumn || !hasUrlColumn || !hasIdColumn) {
    await knex.schema.alterTable('appointment_requests', (table) => {
      if (!hasProviderColumn) {
        table.text('online_meeting_provider').nullable();
      }

      if (!hasUrlColumn) {
        table.text('online_meeting_url').nullable();
      }

      if (!hasIdColumn) {
        table.text('online_meeting_id').nullable();
      }
    });
  }
};

exports.down = async function down(knex) {
  const hasProviderColumn = await knex.schema.hasColumn('appointment_requests', 'online_meeting_provider');
  const hasUrlColumn = await knex.schema.hasColumn('appointment_requests', 'online_meeting_url');
  const hasIdColumn = await knex.schema.hasColumn('appointment_requests', 'online_meeting_id');

  if (hasProviderColumn || hasUrlColumn || hasIdColumn) {
    await knex.schema.alterTable('appointment_requests', (table) => {
      if (hasProviderColumn) {
        table.dropColumn('online_meeting_provider');
      }

      if (hasUrlColumn) {
        table.dropColumn('online_meeting_url');
      }

      if (hasIdColumn) {
        table.dropColumn('online_meeting_id');
      }
    });
  }
};
