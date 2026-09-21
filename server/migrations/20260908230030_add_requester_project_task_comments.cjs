
exports.up = async function(knex) {
  // The original unnamed Knex check only admitted internal authors. Preserve
  // all attribution constraints while extending this one author enum.
  const checks = await knex('pg_constraint').where({ contype: 'c' })
    .whereRaw("conrelid = 'project_task_comments'::regclass")
    .select('conname', knex.raw('pg_get_constraintdef(oid) as definition'));
  for (const check of checks) if (check.definition.includes('author_type') && !check.definition.includes('actor_reference_id'))
    await knex.raw('ALTER TABLE project_task_comments DROP CONSTRAINT ??', [check.conname]);
  await knex.raw("ALTER TABLE project_task_comments ADD CONSTRAINT project_task_comment_author_type CHECK (author_type IN ('internal', 'client'))");
  if (!await knex.schema.hasColumn('project_task_comments', 'request_hash'))
    await knex.schema.alterTable('project_task_comments', table => table.string('request_hash', 64).nullable());
  await require('./utils/permissions/reconcileTenants.cjs').reconcileAllTenants(knex, { label: 'requester project task comments' });
};

exports.down = async function(knex) {
  if (await knex('project_task_comments').where('author_type', 'client').orWhereNotNull('request_hash').first())
    throw new Error('Cannot discard retained requester task conversations');
  await knex.raw("ALTER TABLE project_task_comments DROP CONSTRAINT project_task_comment_author_type, ADD CONSTRAINT project_task_comment_author_type CHECK (author_type = 'internal')");
  await knex.schema.alterTable('project_task_comments', table => table.dropColumn('request_hash'));
};
