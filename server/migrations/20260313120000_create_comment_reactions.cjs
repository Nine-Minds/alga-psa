/**
 * Migration: Create comment_reactions and project_task_comment_reactions tables
 *
 * Adds emoji reaction support for both ticket comments and project task comments.
 * Each table stores individual user reactions with toggle behavior enforced by
 * a unique constraint (one reaction per user per emoji per comment).
 * CitusDB-compatible primary keys with tenant co-location.
 */

exports.up = async function(knex) {
  // ── Ticket comment reactions ──
  await knex.schema.createTable('comment_reactions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('reaction_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('comment_id').notNullable();
    table.uuid('user_id').notNullable();
    table.text('emoji').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();

    table.primary(['reaction_id', 'tenant']);

    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'comment_id'])
      .references(['tenant', 'comment_id'])
      .inTable('comments');
    table.foreign(['tenant', 'user_id'])
      .references(['tenant', 'user_id'])
      .inTable('users');

    table.unique(['tenant', 'comment_id', 'user_id', 'emoji'], {
      indexName: 'uq_comment_reactions_user_emoji'
    });
    table.index(['tenant', 'comment_id'], 'idx_comment_reactions_comment');
  });

  // ── Project task comment reactions ──
  await knex.schema.createTable('project_task_comment_reactions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('reaction_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('task_comment_id').notNullable();
    table.uuid('user_id').notNullable();
    table.text('emoji').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();

    table.primary(['reaction_id', 'tenant']);

    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'task_comment_id'])
      .references(['tenant', 'task_comment_id'])
      .inTable('project_task_comments');
    table.foreign(['tenant', 'user_id'])
      .references(['tenant', 'user_id'])
      .inTable('users');

    table.unique(['tenant', 'task_comment_id', 'user_id', 'emoji'], {
      indexName: 'uq_task_comment_reactions_user_emoji'
    });
    table.index(['tenant', 'task_comment_id'], 'idx_task_comment_reactions_comment');
  });

  // ── Citus distribution ──
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    for (const table of ['comment_reactions', 'project_task_comment_reactions']) {
      const alreadyDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition
          WHERE logicalrelid = '${table}'::regclass
        ) AS is_distributed;
      `);

      if (!alreadyDistributed.rows?.[0]?.is_distributed) {
        await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
      }
    }
  } else {
    console.warn('[create_comment_reactions] Skipping create_distributed_table (function unavailable)');
  }
};

exports.config = { transaction: false };

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('project_task_comment_reactions');
  await knex.schema.dropTableIfExists('comment_reactions');
};
