const TABLES = ['ticket_conversation_editor_drafts', 'ticket_conversation_email_operations', 'ticket_conversation_publications'];
exports.up = async function(knex) {
  for (const table of TABLES) {
    if (!await knex.schema.hasColumn(table, 'publication_options')) await knex.schema.alterTable(table, t => {
      t.jsonb('publication_options').nullable();
      t.check("publication_options IS NULL OR publication_options = '{\"isResolution\":true}'::jsonb", [], `${table}_options_check`);
    });
  }
};
exports.down = async function(knex) {
  for (const table of TABLES) {
    if (await knex.schema.hasColumn(table, 'publication_options') && await knex(table).whereNotNull('publication_options').first())
      throw new Error('Cannot discard retained requester publication options');
  }
  for (const table of [...TABLES].reverse()) if (await knex.schema.hasColumn(table, 'publication_options')) await knex.schema.alterTable(table, t => {
    t.dropChecks([`${table}_options_check`]); t.dropColumn('publication_options');
  });
};
