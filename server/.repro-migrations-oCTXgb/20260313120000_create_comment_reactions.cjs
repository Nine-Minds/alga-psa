/**
 * Migration: Create comment_reactions and project_task_comment_reactions tables
 *
 * Adds emoji reaction support for both ticket comments and project task comments.
 * Each table stores individual user reactions with toggle behavior enforced by
 * a unique constraint (one reaction per user per emoji per comment).
 * CitusDB-compatible primary keys with tenant co-location.
 */

const PROJECT_TASK_COMMENTS_FKS = [
  {
    name: 'project_task_comments_tenant_foreign',
    sql: `
      ALTER TABLE project_task_comments
      ADD CONSTRAINT project_task_comments_tenant_foreign
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) NOT VALID
    `,
  },
  {
    name: 'project_task_comments_tenant_task_id_foreign',
    sql: `
      ALTER TABLE project_task_comments
      ADD CONSTRAINT project_task_comments_tenant_task_id_foreign
      FOREIGN KEY (tenant, task_id)
      REFERENCES project_tasks(tenant, task_id)
      ON DELETE CASCADE
      NOT VALID
    `,
  },
  {
    name: 'project_task_comments_tenant_user_id_foreign',
    sql: `
      ALTER TABLE project_task_comments
      ADD CONSTRAINT project_task_comments_tenant_user_id_foreign
      FOREIGN KEY (tenant, user_id)
      REFERENCES users(tenant, user_id)
      NOT VALID
    `,
  },
];

async function isTableDistributed(knex, tableName) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = ?::regclass
    ) AS is_distributed;
  `, [tableName]);

  return Boolean(result.rows?.[0]?.is_distributed);
}

async function hasConstraint(knex, tableName, constraintName) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = ?::regclass
        AND conname = ?
    ) AS exists;
  `, [tableName, constraintName]);

  return Boolean(result.rows?.[0]?.exists);
}

async function dropProjectTaskCommentsForeignKeys(knex) {
  for (const { name } of PROJECT_TASK_COMMENTS_FKS) {
    await knex.raw(`
      ALTER TABLE project_task_comments
      DROP CONSTRAINT IF EXISTS ${name}
    `);
  }
}

async function ensureProjectTaskCommentsForeignKeys(knex) {
  for (const fk of PROJECT_TASK_COMMENTS_FKS) {
    if (!(await hasConstraint(knex, 'project_task_comments', fk.name))) {
      await knex.raw(fk.sql);
    }
  }
}

exports.up = async function(knex) {
  // ── Ticket comment reactions ──
  if (!(await knex.schema.hasTable('comment_reactions'))) {
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
      table.index(['tenant', 'comment_id', 'created_at'], 'idx_comment_reactions_comment_created');
    });
  }

  // ── Project task comment reactions ──
  if (!(await knex.schema.hasTable('project_task_comment_reactions'))) {
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
      table.index(['tenant', 'task_comment_id', 'created_at'], 'idx_task_comment_reactions_comment_created');
    });
  }

  // ── Citus distribution ──
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    // The FK re-adds below need project_tasks distributed, which on fresh
    // Citus chains pulls in the whole projects subsystem in dependency
    // order. project_status_mappings carries two Citus-incompatible
    // constraints: a lone UNIQUE(project_status_mapping_id) backing a
    // single-column FK from project_tasks (recreated as a composite FK
    // against the PK), and an ON DELETE SET NULL FK to standard_statuses,
    // which must stay local (PK has no tenant) — dropped on Citus. No-op on
    // clusters where the subsystem is already distributed.
    for (const table of ['projects', 'project_phases']) {
      if (!(await isTableDistributed(knex, table))) {
        await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
      }
    }

    if (!(await isTableDistributed(knex, 'project_status_mappings'))) {
      for (const [table, constraint] of [
        ['project_tasks', 'project_tasks_project_status_mapping_id_foreign'],
        ['project_status_mappings', 'project_status_mappings_project_status_mapping_id_unique'],
        ['project_status_mappings', 'project_status_mappings_standard_status_id_foreign'],
      ]) {
        if (await hasConstraint(knex, table, constraint)) {
          await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
        }
      }
      await knex.raw(`SELECT create_distributed_table('project_status_mappings', 'tenant', colocate_with => 'tenants')`);
    }

    if (!(await isTableDistributed(knex, 'project_tasks'))) {
      await knex.raw(`SELECT create_distributed_table('project_tasks', 'tenant', colocate_with => 'tenants')`);
    }

    if (!(await hasConstraint(knex, 'project_tasks', 'project_tasks_project_status_mapping_id_foreign'))) {
      await knex.raw(`
        ALTER TABLE project_tasks
        ADD CONSTRAINT project_tasks_project_status_mapping_id_foreign
        FOREIGN KEY (tenant, project_status_mapping_id)
        REFERENCES project_status_mappings(tenant, project_status_mapping_id)
      `);
    }

    const projectTaskCommentsExists = await knex.schema.hasTable('project_task_comments');

    if (projectTaskCommentsExists && !(await isTableDistributed(knex, 'project_task_comments'))) {
      // Existing hosts may contain legacy orphan rows. Drop these FKs before
      // Citus copies local rows into shards, then re-add them as NOT VALID
      // after distribution so future writes are still enforced.
      await dropProjectTaskCommentsForeignKeys(knex);
    }

    // comments / project_task_comments must be distributed before the
    // reaction tables that FK them (Citus requires referenced tables to be
    // distributed). comments is a no-op on clusters that already have it.
    for (const table of ['comments', 'project_task_comments', 'comment_reactions', 'project_task_comment_reactions']) {
      if (!(await isTableDistributed(knex, table))) {
        await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
      }
    }

    if (await isTableDistributed(knex, 'project_task_comments')) {
      await ensureProjectTaskCommentsForeignKeys(knex);
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
