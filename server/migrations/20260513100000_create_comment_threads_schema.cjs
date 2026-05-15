/**
 * Create the comment_threads table + all reversible schema additions for
 * first-class comment threading on tickets, project tasks, and outbound email.
 *
 * Consolidates:
 *   - Create `comment_threads` + Citus distribution (colocated with `tenants`).
 *   - Lookup indexes for thread listing and email correlation.
 *   - Nullable `thread_id`/`parent_comment_id`/`deleted_at` columns + FKs on
 *     `comments` and `project_task_comments`. Columns stay nullable until the
 *     follow-up backfill + NOT-NULL enforcement migrations complete.
 *   - Nullable `comment_thread_id` + FK + partial index on `email_sending_logs`
 *     for outbound thread correlation. The existing `email_sending_logs.thread_id`
 *     column is provider-owned thread identity and is intentionally untouched.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await createCommentThreadsTable(knex);
  await ensureCitusDistribution(knex);
  await createCommentThreadsIndexes(knex);
  await addThreadingColumnsToComments(knex);
  await addThreadingColumnsToProjectTaskComments(knex);
  await addCommentThreadIdToEmailSendingLogs(knex);
};

async function createCommentThreadsTable(knex) {
  const exists = await knex.schema.hasTable('comment_threads');
  if (exists) {
    return;
  }

  await knex.schema.createTable('comment_threads', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('thread_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('ticket_id').nullable();
    table.uuid('project_task_id').nullable();
    table.uuid('root_comment_id').notNullable();
    table.boolean('is_internal').notNullable().defaultTo(false);
    table.integer('reply_count').notNullable().defaultTo(0);
    table.timestamp('last_activity_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('email_message_id').nullable();
    table.specificType('email_references', 'text[]').notNullable().defaultTo(knex.raw("'{}'::text[]"));
    table.text('email_provider_thread_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.uuid('created_by').nullable();

    table.primary(['tenant', 'thread_id']);
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    table
      .foreign(['tenant', 'ticket_id'], 'comment_threads_ticket_fk')
      .references(['tenant', 'ticket_id'])
      .inTable('tickets')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'project_task_id'], 'comment_threads_project_task_fk')
      .references(['tenant', 'task_id'])
      .inTable('project_tasks')
      .onDelete('CASCADE');
    table.check(
      '((?? IS NOT NULL)::int + (?? IS NOT NULL)::int = 1)',
      ['ticket_id', 'project_task_id'],
      'comment_threads_exactly_one_parent_check'
    );
  });
}

async function ensureCitusDistribution(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'citus'
    ) AS enabled
  `);

  if (!citusEnabled.rows?.[0]?.enabled) {
    console.warn('[create_comment_threads_schema] Skipping create_distributed_table (Citus extension unavailable)');
    return;
  }

  const alreadyDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_dist_partition
      WHERE logicalrelid = 'comment_threads'::regclass
    ) AS is_distributed
  `);

  if (!alreadyDistributed.rows?.[0]?.is_distributed) {
    await knex.raw("SELECT create_distributed_table('comment_threads', 'tenant', colocate_with => 'tenants')");
  }
}

async function createCommentThreadsIndexes(knex) {
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS comment_threads_ticket_idx
    ON comment_threads (tenant, ticket_id, last_activity_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS comment_threads_task_idx
    ON comment_threads (tenant, project_task_id, last_activity_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS comment_threads_email_msgid_idx
    ON comment_threads (tenant, email_message_id)
    WHERE email_message_id IS NOT NULL
  `);
}

async function addThreadingColumnsToComments(knex) {
  const hasThreadId = await knex.schema.hasColumn('comments', 'thread_id');
  const hasParent = await knex.schema.hasColumn('comments', 'parent_comment_id');
  const hasDeletedAt = await knex.schema.hasColumn('comments', 'deleted_at');

  if (!hasThreadId || !hasParent || !hasDeletedAt) {
    await knex.schema.alterTable('comments', (table) => {
      if (!hasThreadId) table.uuid('thread_id').nullable();
      if (!hasParent) table.uuid('parent_comment_id').nullable();
      if (!hasDeletedAt) table.timestamp('deleted_at', { useTz: true }).nullable();
    });
  }

  // CASCADE: deleting a thread (incl. via tickets -> comment_threads) must not
  // orphan comments; self-FK CASCADE lets bulk ticket deletes drop parent+child
  // without stalling on the self-referential check.
  await addForeignKeyIfMissing(knex, 'comments', 'comments_thread_fk', (table) => {
    table
      .foreign(['tenant', 'thread_id'], 'comments_thread_fk')
      .references(['tenant', 'thread_id'])
      .inTable('comment_threads')
      .onDelete('CASCADE');
  });
  await addForeignKeyIfMissing(knex, 'comments', 'comments_parent_comment_fk', (table) => {
    table
      .foreign(['tenant', 'parent_comment_id'], 'comments_parent_comment_fk')
      .references(['tenant', 'comment_id'])
      .inTable('comments')
      .onDelete('CASCADE');
  });
}

async function addThreadingColumnsToProjectTaskComments(knex) {
  const hasThreadId = await knex.schema.hasColumn('project_task_comments', 'thread_id');
  const hasParent = await knex.schema.hasColumn('project_task_comments', 'parent_comment_id');
  const hasDeletedAt = await knex.schema.hasColumn('project_task_comments', 'deleted_at');

  if (!hasThreadId || !hasParent || !hasDeletedAt) {
    await knex.schema.alterTable('project_task_comments', (table) => {
      if (!hasThreadId) table.uuid('thread_id').nullable();
      if (!hasParent) table.uuid('parent_comment_id').nullable();
      if (!hasDeletedAt) table.timestamp('deleted_at', { useTz: true }).nullable();
    });
  }

  await addForeignKeyIfMissing(knex, 'project_task_comments', 'project_task_comments_thread_fk', (table) => {
    table
      .foreign(['tenant', 'thread_id'], 'project_task_comments_thread_fk')
      .references(['tenant', 'thread_id'])
      .inTable('comment_threads')
      .onDelete('CASCADE');
  });
  await addForeignKeyIfMissing(knex, 'project_task_comments', 'project_task_comments_parent_comment_fk', (table) => {
    table
      .foreign(['tenant', 'parent_comment_id'], 'project_task_comments_parent_comment_fk')
      .references(['tenant', 'task_comment_id'])
      .inTable('project_task_comments')
      .onDelete('CASCADE');
  });
}

async function addCommentThreadIdToEmailSendingLogs(knex) {
  // Per 20251117000000_standardize_email_tenant_columns_all_envs.cjs, every
  // environment has `email_sending_logs.tenant` (uuid). Older `tenant_id`
  // (varchar) columns were removed before this migration runs.
  const hasTenant = await knex.schema.hasColumn('email_sending_logs', 'tenant');
  if (!hasTenant) {
    throw new Error(
      'email_sending_logs.tenant column is missing; run ' +
      '20251117000000_standardize_email_tenant_columns_all_envs.cjs first.'
    );
  }

  const hasCommentThreadId = await knex.schema.hasColumn('email_sending_logs', 'comment_thread_id');
  if (!hasCommentThreadId) {
    await knex.schema.alterTable('email_sending_logs', (table) => {
      table.uuid('comment_thread_id').nullable();
    });
  }

  // SET NULL preserves email-log history when a thread is deleted.
  await addForeignKeyIfMissing(knex, 'email_sending_logs', 'email_sending_logs_comment_thread_fk', (table) => {
    table
      .foreign(['tenant', 'comment_thread_id'], 'email_sending_logs_comment_thread_fk')
      .references(['tenant', 'thread_id'])
      .inTable('comment_threads')
      .onDelete('SET NULL');
  });

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_email_sending_logs_tenant_comment_thread
    ON email_sending_logs (tenant, comment_thread_id, created_at DESC)
    WHERE comment_thread_id IS NOT NULL
  `);
}

// Re-runnable FK add: knex .foreign() has no IF NOT EXISTS, so a re-run
// (after wiping knex_migrations to replay this branch) would fail on the
// already-present constraint.
async function addForeignKeyIfMissing(knex, table, constraintName, build) {
  const exists = await knex.raw(
    'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [constraintName, table]
  );
  if (exists.rows?.length) {
    return;
  }
  await knex.schema.alterTable(table, build);
}

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  // email_sending_logs FK + index + column
  await knex.schema.raw('DROP INDEX IF EXISTS idx_email_sending_logs_tenant_comment_thread');
  if (await knex.schema.hasColumn('email_sending_logs', 'comment_thread_id')) {
    await knex.schema.alterTable('email_sending_logs', (table) => {
      table.dropForeign(['tenant', 'comment_thread_id'], 'email_sending_logs_comment_thread_fk');
      table.dropColumn('comment_thread_id');
    });
  }

  // project_task_comments FKs + columns
  if (await knex.schema.hasTable('project_task_comments')) {
    await knex.schema.alterTable('project_task_comments', (table) => {
      table.dropForeign(['tenant', 'parent_comment_id'], 'project_task_comments_parent_comment_fk');
      table.dropForeign(['tenant', 'thread_id'], 'project_task_comments_thread_fk');
    });
    const taskDeletedAt = await knex.schema.hasColumn('project_task_comments', 'deleted_at');
    const taskParent = await knex.schema.hasColumn('project_task_comments', 'parent_comment_id');
    const taskThreadId = await knex.schema.hasColumn('project_task_comments', 'thread_id');
    if (taskDeletedAt || taskParent || taskThreadId) {
      await knex.schema.alterTable('project_task_comments', (table) => {
        if (taskDeletedAt) table.dropColumn('deleted_at');
        if (taskParent) table.dropColumn('parent_comment_id');
        if (taskThreadId) table.dropColumn('thread_id');
      });
    }
  }

  // comments FKs + columns
  await knex.schema.alterTable('comments', (table) => {
    table.dropForeign(['tenant', 'parent_comment_id'], 'comments_parent_comment_fk');
    table.dropForeign(['tenant', 'thread_id'], 'comments_thread_fk');
  });
  await knex.schema.alterTable('comments', (table) => {
    table.dropColumn('deleted_at');
    table.dropColumn('parent_comment_id');
    table.dropColumn('thread_id');
  });

  // comment_threads table (indexes drop with the table)
  await knex.schema.dropTableIfExists('comment_threads');
};

// create_distributed_table and ALTER TABLE ... ADD FOREIGN KEY on Citus
// distributed tables must run outside a transaction block.
exports.config = { transaction: false };
