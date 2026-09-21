/** Preserve native task comments, adding qualified foreign attribution and
 * revisions. Legacy task threads remain private regardless of is_internal. */
exports.up = async function(knex) {
  for (const [name, type] of [['actor_reference_id', 'uuid'], ['actor_display_name', 'text'], ['actor_organization_name', 'text']])
    if (!await knex.schema.hasColumn('project_task_comments', name)) await knex.schema.alterTable('project_task_comments', table => table[type](name).nullable());
  if (!await knex.schema.hasColumn('project_task_comments', 'collaboration_revision')) await knex.schema.alterTable('project_task_comments', table => table.integer('collaboration_revision').notNullable().defaultTo(1));
  await knex.raw('ALTER TABLE project_task_comments ALTER COLUMN user_id DROP NOT NULL');
  for (const [name, sql] of [
    ['project_task_comment_actor_shape', `CHECK ((actor_reference_id IS NULL AND user_id IS NOT NULL) OR (actor_reference_id IS NOT NULL AND user_id IS NULL AND author_type IS NOT NULL AND author_type = 'internal'
      AND actor_display_name IS NOT NULL AND char_length(actor_display_name) > 0 AND actor_organization_name IS NOT NULL AND char_length(actor_organization_name) > 0))`],
    ['project_task_comment_revision_positive', 'CHECK (collaboration_revision > 0)'],
    ['project_task_comment_actor_reference_fk', 'FOREIGN KEY (tenant, actor_reference_id) REFERENCES collaboration_actor_references (tenant, actor_reference_id)'],
  ]) if (!await knex('pg_constraint').where('conname', name).whereRaw("conrelid = 'project_task_comments'::regclass").first())
    await knex.raw(`ALTER TABLE project_task_comments ADD CONSTRAINT ?? ${sql}`, [name]);
};
exports.down = async function(knex) {
  if (await knex('project_task_comments').whereNotNull('actor_reference_id').orWhereNotNull('actor_display_name').orWhereNotNull('actor_organization_name').orWhere('collaboration_revision', '>', 1).first())
    throw new Error('Cannot remove retained project task collaboration attribution or revisions');
  if (await knex('comment_threads').whereNotNull('project_task_id').whereNotNull('collaboration_audience').first())
    throw new Error('Cannot remove retained project task collaboration audiences');
  await knex.raw('ALTER TABLE project_task_comments DROP CONSTRAINT IF EXISTS project_task_comment_actor_shape, DROP CONSTRAINT IF EXISTS project_task_comment_revision_positive, DROP CONSTRAINT IF EXISTS project_task_comment_actor_reference_fk');
  await knex.raw('ALTER TABLE project_task_comments ALTER COLUMN user_id SET NOT NULL');
  await knex.schema.alterTable('project_task_comments', table => { for (const name of ['actor_reference_id', 'actor_display_name', 'actor_organization_name', 'collaboration_revision']) table.dropColumn(name); });
};
