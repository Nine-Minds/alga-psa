const TABLES = ['ticket_conversation_editor_drafts', 'ticket_conversation_email_operations', 'ticket_conversation_publications'];
const original = "publication_options IS NULL OR publication_options = '{\"isResolution\":true}'::jsonb";
const expanded = `publication_options IS NULL OR (
  jsonb_typeof(publication_options) = 'object' AND publication_options @> '{"isResolution":true}'::jsonb
  AND publication_options - ARRAY['isResolution', 'close'] = '{}'::jsonb
  AND (NOT (jsonb_exists(publication_options, 'close')) OR (
    jsonb_typeof(publication_options->'close') = 'object'
    AND jsonb_exists(publication_options->'close', 'statusId')
    AND jsonb_typeof(publication_options->'close'->'statusId') = 'string'
    AND (publication_options->'close'->>'statusId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (publication_options->'close') - ARRAY['statusId', 'overrideReason'] = '{}'::jsonb
    AND (NOT (jsonb_exists(publication_options->'close', 'overrideReason')) OR (
      jsonb_typeof(publication_options->'close'->'overrideReason') = 'string'
      AND length(publication_options->'close'->>'overrideReason') <= 4000
    ))
  ))
)`;
async function constrain(knex, expression) {
  for (const table of TABLES) {
    const name = `${table}_options_check`;
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [table, name]);
    await knex.schema.alterTable(table, t => t.check(expression, [], name));
  }
}
exports.up = async knex => {
  // A replay must not narrow the later schedule-capable options constraint.
  if (await knex.schema.hasColumn('ticket_conversation_email_operations', 'scheduled_comment_hash')) return;
  await constrain(knex, expanded);
};
exports.down = async function(knex) {
  for (const table of TABLES) if (await knex(table).whereRaw("jsonb_exists(publication_options, 'close')").first())
    throw new Error('Cannot discard retained requester close intent');
  await constrain(knex, original);
};
