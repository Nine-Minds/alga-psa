// AI is a retained author type, never a synthetic login or an actor reference.
const RUNS = 'ticket_conversation_ai_runs';
async function resultConstraint(knex, definition) {
  const checks = await knex('pg_constraint').whereRaw('conrelid = ?::regclass', [RUNS]).where('contype', 'c')
    .select('conname', knex.raw('pg_get_constraintdef(oid) AS definition'));
  for (const check of checks) if (check.definition.includes('prepared_draft_revision'))
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [RUNS, check.conname]);
  await knex.raw('ALTER TABLE ?? ADD CONSTRAINT conversation_ai_result_shape CHECK (' + definition + ')', [RUNS]);
}
exports.up = async function(knex) {
  await knex.raw("ALTER TYPE comment_author_type ADD VALUE IF NOT EXISTS 'ai'");
  await knex.raw('ALTER TABLE co_management_private_comments DROP CONSTRAINT IF EXISTS private_comment_author_identity_check');
  await knex.raw(`ALTER TABLE co_management_private_comments ADD CONSTRAINT private_comment_author_identity_check CHECK (
    (actor_kind = 'user' AND actor_user_id IS NOT NULL AND external_author_email IS NULL) OR
    (actor_kind = 'external' AND actor_user_id IS NULL AND external_author_email IS NOT NULL) OR
    (actor_kind = 'ai' AND actor_user_id IS NULL AND external_author_email IS NULL))`);
  if (!await knex('pg_constraint').where({ conname: 'comments_ai_author_identity' }).whereRaw("conrelid = 'comments'::regclass").first())
    await knex.raw(`ALTER TABLE comments ADD CONSTRAINT comments_ai_author_identity CHECK
      (author_type::text <> 'ai' OR (user_id IS NULL AND contact_id IS NULL AND actor_reference_id IS NULL AND is_system_generated IS TRUE))`);
  await resultConstraint(knex, `(status = 'completed' AND generated_text IS NOT NULL AND
    ((kind = 'synthesis' AND prepared_draft_revision IS NOT NULL) OR
     (kind = 'conversation_reply' AND prepared_draft_revision IS NULL AND published_comment_id IS NOT NULL AND published_thread_id IS NOT NULL))) OR
    (status <> 'completed' AND generated_text IS NULL AND prepared_draft_revision IS NULL)`);
};
exports.down = async function(knex) {
  if (await knex(RUNS).where('kind', 'conversation_reply').first() || await knex('comments').whereRaw("author_type::text = 'ai'").first() ||
      await knex('co_management_private_comments').where('actor_kind', 'ai').first()) throw new Error('Cannot discard retained conversation AI participation');
  await resultConstraint(knex, `(status = 'completed' AND generated_text IS NOT NULL AND prepared_draft_revision IS NOT NULL) OR
    (status <> 'completed' AND generated_text IS NULL AND prepared_draft_revision IS NULL)`);
  await knex.raw('ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_ai_author_identity');
  await knex.raw('ALTER TABLE co_management_private_comments DROP CONSTRAINT IF EXISTS private_comment_author_identity_check');
  await knex.raw(`ALTER TABLE co_management_private_comments ADD CONSTRAINT private_comment_author_identity_check CHECK (
    (actor_kind = 'user' AND actor_user_id IS NOT NULL AND external_author_email IS NULL) OR
    (actor_kind = 'external' AND actor_user_id IS NULL AND external_author_email IS NOT NULL))`);
  // PostgreSQL cannot remove one enum label safely; the unused additive label remains.
};
exports.config = { transaction: false };
