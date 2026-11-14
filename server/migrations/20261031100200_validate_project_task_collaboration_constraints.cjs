// CM L4c (3 of 4): VALIDATE only. Each scan runs under SHARE UPDATE EXCLUSIVE while reads and
// writes continue, so it lives in its own non-transactional file. Idempotent; each step is a
// no-op when the constraint is absent or already valid.
exports.config = { transaction: false };

const CONSTRAINTS = [
  'project_task_comments_revision_positive',
  'project_task_comments_collaboration_actor_fk',
  'project_task_comments_author_type',
  'project_task_comments_author_kind',
  'project_task_comments_author_shape',
  'project_task_comments_contact_fk',
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('project_task_comments'))) return;
  for (const name of CONSTRAINTS) {
    const { rows } = await knex.raw(`SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = 'project_task_comments'::regclass`, [name]);
    if (rows.length > 0 && !rows[0].convalidated) await knex.raw('ALTER TABLE project_task_comments VALIDATE CONSTRAINT ??', [name]);
  }
};

exports.down = async function down() {
  // Forward-only: a validated constraint is not un-validated. The NOT VALID files' downs remove the constraints.
};
