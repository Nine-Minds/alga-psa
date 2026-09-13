const TABLES = ['ticket_conversation_editor_drafts', 'ticket_conversation_email_operations', 'ticket_conversation_publications'];
const expression = `publication_options IS NULL OR (
  jsonb_typeof(publication_options) = 'object'
  AND publication_options - ARRAY['isResolution', 'close', 'schedule'] = '{}'::jsonb
  AND (jsonb_exists(publication_options, 'isResolution') OR jsonb_exists(publication_options, 'schedule'))
  AND (NOT jsonb_exists(publication_options, 'isResolution') OR publication_options->'isResolution' = 'true'::jsonb)
  AND (NOT jsonb_exists(publication_options, 'close') OR (
    publication_options @> '{"isResolution":true}'::jsonb AND NOT jsonb_exists(publication_options, 'schedule')
    AND jsonb_typeof(publication_options->'close') = 'object'
    AND jsonb_exists(publication_options->'close', 'statusId')
    AND jsonb_typeof(publication_options->'close'->'statusId') = 'string'
    AND (publication_options->'close'->>'statusId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (publication_options->'close') - ARRAY['statusId', 'overrideReason'] = '{}'::jsonb
    AND (NOT jsonb_exists(publication_options->'close', 'overrideReason') OR (
      jsonb_typeof(publication_options->'close'->'overrideReason') = 'string'
      AND length(publication_options->'close'->>'overrideReason') <= 4000
    ))
  ))
  AND (NOT jsonb_exists(publication_options, 'schedule') OR (
    jsonb_typeof(publication_options->'schedule') = 'object'
    AND (publication_options->'schedule') - ARRAY['at', 'timeZone'] = '{}'::jsonb
    AND jsonb_exists(publication_options->'schedule', 'at') AND jsonb_exists(publication_options->'schedule', 'timeZone')
    AND jsonb_typeof(publication_options->'schedule'->'at') = 'string'
    AND (publication_options->'schedule'->>'at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    AND jsonb_typeof(publication_options->'schedule'->'timeZone') = 'string'
    AND length(publication_options->'schedule'->>'timeZone') BETWEEN 1 AND 64
  ))
)`;
async function statuses(knex, values) {
  const constraints = await knex.raw("SELECT conname FROM pg_constraint WHERE conrelid = 'ticket_conversation_email_operations'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ '\\mstatus\\M'");
  for (const row of constraints.rows) await knex.raw('ALTER TABLE ticket_conversation_email_operations DROP CONSTRAINT ??', [row.conname]);
  await knex.schema.alterTable('ticket_conversation_email_operations', t => t.check(`status IN (${values.map(value => `'${value}'`).join(',')})`, [], 'ticket_conversation_email_status_check'));
}
const originalStatuses = ['reviewed', 'pending', 'sending', 'delivered', 'unknown', 'blocked'];
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn('ticket_conversation_email_operations', 'scheduled_comment_hash'))
    await knex.schema.alterTable('ticket_conversation_email_operations', t => {
      t.string('scheduled_comment_hash', 64).nullable();
      t.check("scheduled_comment_hash IS NULL OR scheduled_comment_hash ~ '^[a-f0-9]{64}$'", [], 'named_scheduled_comment_hash_check');
    });
  for (const table of TABLES) {
    const name = `${table}_options_check`;
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [table, name]);
    await knex.schema.alterTable(table, t => t.check(expression, [], name));
  }
  await statuses(knex, [...originalStatuses, 'scheduled', 'canceled']);
};
exports.down = async function(knex) {
  for (const table of TABLES) if (await knex(table).whereRaw("jsonb_exists(publication_options, 'schedule')").first())
    throw new Error('Cannot discard retained requester schedule intent');
  if (await knex('ticket_conversation_email_operations').whereIn('status', ['scheduled', 'canceled']).first())
    throw new Error('Cannot discard retained requester schedule state');
  if (await knex.schema.hasColumn('ticket_conversation_email_operations', 'scheduled_comment_hash'))
    await knex.schema.alterTable('ticket_conversation_email_operations', t => { t.dropChecks(['named_scheduled_comment_hash_check']); t.dropColumn('scheduled_comment_hash'); });
  await require('./20260908094308_retain_named_requester_close_intent.cjs').up(knex);
  await statuses(knex, originalStatuses);
};
