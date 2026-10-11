const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

async function constraint(knex, table, name, install) {
  if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [table]).first()) await install();
}
exports.up = async function (knex) {
  // NULL retains legacy semantics: internal notes are organization-private.
  if (!await knex.schema.hasColumn('comment_threads', 'collaboration_audience')) await knex.schema.alterTable('comment_threads', table => {
    table.string('collaboration_audience', 32).nullable();
  });
  await constraint(knex, 'comment_threads', 'comment_threads_collaboration_audience_check', () => knex.raw(`
    ALTER TABLE comment_threads ADD CONSTRAINT comment_threads_collaboration_audience_check
    CHECK (collaboration_audience IS NULL OR (collaboration_audience IN ('requester', 'shared_it', 'organization_private')
      AND is_internal = (collaboration_audience <> 'requester')))`));
  for (const [name, type] of [['actor_reference_id', 'uuid'], ['actor_display_name', 'text'], ['actor_organization_name', 'text']]) {
    if (!await knex.schema.hasColumn('comments', name)) await knex.schema.alterTable('comments', table => table[type](name).nullable());
  }
  await constraint(knex, 'comments', 'comments_collaboration_actor_check', () => knex.raw(`
    ALTER TABLE comments ADD CONSTRAINT comments_collaboration_actor_check CHECK (
      (actor_reference_id IS NULL AND actor_display_name IS NULL AND actor_organization_name IS NULL) OR
      (actor_reference_id IS NOT NULL AND user_id IS NULL AND contact_id IS NULL AND author_type IS NOT NULL AND author_type = 'internal'
        AND actor_display_name IS NOT NULL AND char_length(actor_display_name) > 0
        AND actor_organization_name IS NOT NULL AND char_length(actor_organization_name) > 0))`));
  await constraint(knex, 'comments', 'comments_collaboration_actor_fk', () => knex.schema.alterTable('comments', table => {
    table.foreign(['tenant', 'actor_reference_id'], 'comments_collaboration_actor_fk')
      .references(['tenant', 'actor_reference_id']).inTable('collaboration_actor_references');
  }));
  if (!await knex.schema.hasTable('co_management_private_threads')) await knex.schema.createTable('co_management_private_threads', table => {
    table.uuid('tenant').notNullable();
    table.uuid('thread_id').notNullable();
    // The source is a qualified soft reference; no cross-tenant FK or shadow work item.
    table.uuid('customer_tenant').notNullable();
    table.uuid('relationship_id').notNullable();
    table.string('resource_type', 32).notNullable();
    table.uuid('resource_id').notNullable();
    table.uuid('root_comment_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_activity_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'thread_id']);
    table.check('tenant <> customer_tenant');
    table.check("resource_type IN ('ticket', 'project_task')");
    table.index(['tenant', 'customer_tenant', 'relationship_id', 'resource_type', 'resource_id'], 'co_management_private_thread_resource_idx');
  });
  await ensureTenantDistribution(knex, 'co_management_private_threads');
  if (!await knex.schema.hasTable('co_management_private_comments')) await knex.schema.createTable('co_management_private_comments', table => {
    table.uuid('tenant').notNullable(); table.uuid('comment_id').notNullable(); table.uuid('thread_id').notNullable();
    table.uuid('parent_comment_id').nullable();
    // Historical home identity and display snapshots survive account deletion.
    table.uuid('actor_user_id').notNullable(); table.text('actor_display_name').notNullable(); table.text('actor_organization_name').notNullable();
    table.text('note').notNullable(); table.text('markdown_content').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('deleted_at', { useTz: true }).nullable();
    table.integer('revision').notNullable().defaultTo(1);
    table.primary(['tenant', 'comment_id']);
    table.unique(['tenant', 'comment_id', 'thread_id'], { indexName: 'co_management_private_comment_thread_unique' });
    table.check('revision > 0');
    table.check('parent_comment_id IS NULL OR parent_comment_id <> comment_id');
    table.check('char_length(actor_display_name) > 0 AND char_length(actor_organization_name) > 0');
    table.index(['tenant', 'thread_id', 'created_at', 'comment_id'], 'co_management_private_comment_chronology_idx');
  });
  await ensureTenantDistribution(knex, 'co_management_private_comments');
  await constraint(knex, 'co_management_private_comments', 'co_management_private_comment_thread_fk', () => knex.schema.alterTable('co_management_private_comments', table => {
    table.foreign(['tenant', 'thread_id'], 'co_management_private_comment_thread_fk').references(['tenant', 'thread_id']).inTable('co_management_private_threads');
  }));
  await constraint(knex, 'co_management_private_comments', 'co_management_private_comment_parent_fk', () => knex.schema.alterTable('co_management_private_comments', table => {
    table.foreign(['tenant', 'parent_comment_id', 'thread_id'], 'co_management_private_comment_parent_fk')
      .references(['tenant', 'comment_id', 'thread_id']).inTable('co_management_private_comments');
  }));
};
exports.down = async function (knex) {
  for (const table of ['co_management_private_comments', 'co_management_private_threads']) {
    if (await knex.schema.hasTable(table) && await knex(table).first()) throw new Error('Cannot discard retained co-management private content');
  }
  if ((await knex.schema.hasColumn('comments', 'actor_reference_id') && await knex('comments').whereNotNull('actor_reference_id').first()) ||
      (await knex.schema.hasColumn('comment_threads', 'collaboration_audience') && await knex('comment_threads').whereNotNull('collaboration_audience').first())) {
    throw new Error('Cannot discard retained collaboration audiences or attribution');
  }
  await knex.schema.dropTableIfExists('co_management_private_comments'); await knex.schema.dropTableIfExists('co_management_private_threads');
  await knex.raw('ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_collaboration_actor_fk, DROP CONSTRAINT IF EXISTS comments_collaboration_actor_check');
  for (const name of ['actor_reference_id', 'actor_display_name', 'actor_organization_name']) if (await knex.schema.hasColumn('comments', name)) await knex.schema.alterTable('comments', table => table.dropColumn(name));
  await knex.raw('ALTER TABLE comment_threads DROP CONSTRAINT IF EXISTS comment_threads_collaboration_audience_check');
  if (await knex.schema.hasColumn('comment_threads', 'collaboration_audience')) await knex.schema.alterTable('comment_threads', table => table.dropColumn('collaboration_audience'));
};
exports.config = { transaction: false };
