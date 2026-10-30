// CM L4a (4 of 5): organisation-private notes on shared work, retained in the AUTHOR's
// tenant (tenant <> customer_tenant). Bodies never land in the shared tenant and there is
// no inline duplicate there. New tables only; distributed by tenant (Citus). The source is
// a qualified soft reference: no cross-tenant FK and no shadow work item. Idempotent.
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

async function constraint(knex, table, name, install) {
  const { rows } = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`, [name, table]);
  if (!rows.length) await install();
}

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_management_private_threads'))) {
    await knex.schema.createTable('co_management_private_threads', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('thread_id').notNullable();
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
  }
  await ensureTenantDistribution(knex, 'co_management_private_threads');

  if (!(await knex.schema.hasTable('co_management_private_comments'))) {
    await knex.schema.createTable('co_management_private_comments', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('comment_id').notNullable();
      table.uuid('thread_id').notNullable();
      table.uuid('parent_comment_id').nullable();
      // Historical home identity and display snapshots survive account deletion.
      table.uuid('actor_user_id').notNullable();
      table.text('actor_display_name').notNullable();
      table.text('actor_organization_name').notNullable();
      table.text('note').notNullable();
      table.text('markdown_content').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      // Tombstone: set when the root is deleted; the body is redacted and replies are kept.
      table.timestamp('deleted_at', { useTz: true }).nullable();
      table.integer('revision').notNullable().defaultTo(1);
      table.primary(['tenant', 'comment_id']);
      table.unique(['tenant', 'comment_id', 'thread_id'], { indexName: 'co_management_private_comment_thread_unique' });
      table.check('revision > 0');
      table.check('parent_comment_id IS NULL OR parent_comment_id <> comment_id');
      table.check('char_length(actor_display_name) > 0 AND char_length(actor_organization_name) > 0');
      table.index(['tenant', 'thread_id', 'created_at', 'comment_id'], 'co_management_private_comment_chronology_idx');
    });
  }
  await ensureTenantDistribution(knex, 'co_management_private_comments');
  await constraint(knex, 'co_management_private_comments', 'co_management_private_comment_thread_fk', () =>
    knex.schema.alterTable('co_management_private_comments', (table) => {
      table.foreign(['tenant', 'thread_id'], 'co_management_private_comment_thread_fk').references(['tenant', 'thread_id']).inTable('co_management_private_threads');
    }));
  await constraint(knex, 'co_management_private_comments', 'co_management_private_comment_parent_fk', () =>
    knex.schema.alterTable('co_management_private_comments', (table) => {
      table.foreign(['tenant', 'parent_comment_id', 'thread_id'], 'co_management_private_comment_parent_fk')
        .references(['tenant', 'comment_id', 'thread_id']).inTable('co_management_private_comments');
    }));
};

exports.down = async function down(knex) {
  for (const table of ['co_management_private_comments', 'co_management_private_threads']) {
    if ((await knex.schema.hasTable(table)) && (await knex(table).first())) {
      throw new Error('Cannot discard retained co-management private content');
    }
  }
  await knex.schema.dropTableIfExists('co_management_private_comments');
  await knex.schema.dropTableIfExists('co_management_private_threads');
};
