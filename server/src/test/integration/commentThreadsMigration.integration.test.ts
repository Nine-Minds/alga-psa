import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const backfillMigration = require('../../../migrations/20260513100500_backfill_comment_threads.cjs');
// One consolidated backfill now handles both ticket and project-task comments.
const commentBackfillMigration = backfillMigration;
const taskCommentBackfillMigration = backfillMigration;

describe('comment_threads migrations', () => {
  let knex: Knex;

  function scopedDb(tenant: string) {
    return tenantDb(knex, tenant);
  }

  function tenantTable(tenant: string, table: string) {
    return scopedDb(tenant).table(table);
  }

  function schemaTable(table: string, reason: string) {
    return tenantDb(knex, '__test_schema__').unscoped(table, reason);
  }

  async function ticketUserContext() {
    const discoveryDb = tenantDb(knex, '__test_discovery__');
    const query = discoveryDb.unscoped(
      'tickets as t',
      'test discovery of seeded ticket/user context for comment thread migration'
    );
    discoveryDb.tenantJoin(query, 'users as u', 'u.tenant', 't.tenant');
    return query
      .select('t.tenant', 't.ticket_id', 'u.user_id')
      .first();
  }

  async function taskUserContext() {
    const discoveryDb = tenantDb(knex, '__test_discovery__');
    const query = discoveryDb.unscoped(
      'project_tasks as pt',
      'test discovery of seeded project task/user context for comment thread migration'
    );
    discoveryDb.tenantJoin(query, 'users as u', 'u.tenant', 'pt.tenant');
    return query
      .select('pt.tenant', 'pt.task_id', 'u.user_id')
      .first();
  }

  beforeAll(async () => {
    knex = await createTestDbConnection();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('T001: creates comment_threads table with expected columns, primary key, check, and parent FKs', async () => {
    const tableExists = await knex.schema.hasTable('comment_threads');
    expect(tableExists).toBe(true);

    const expectedColumns = [
      'tenant',
      'thread_id',
      'ticket_id',
      'project_task_id',
      'root_comment_id',
      'is_internal',
      'reply_count',
      'last_activity_at',
      'email_message_id',
      'email_references',
      'email_provider_thread_id',
      'created_at',
      'created_by',
    ];

    for (const column of expectedColumns) {
      await expect(knex.schema.hasColumn('comment_threads', column)).resolves.toBe(true);
    }

    const constraints = await schemaTable('pg_constraint as c', 'test schema assertion for comment thread migration constraints')
      .join('pg_class as rel', 'rel.oid', 'c.conrelid')
      .select('c.conname', 'c.contype', knex.raw('pg_get_constraintdef(c.oid) as definition'))
      .where('rel.relname', 'comment_threads');

    const primaryKey = constraints.find((constraint) => constraint.contype === 'p');
    expect(primaryKey?.definition).toContain('PRIMARY KEY (tenant, thread_id)');

    const checkConstraint = constraints.find(
      (constraint) => constraint.contype === 'c' && String(constraint.definition).includes('ticket_id')
    );
    expect(checkConstraint?.definition).toContain('CHECK');
    expect(checkConstraint?.definition).toContain('project_task_id');

    const foreignKeys = constraints.filter((constraint) => constraint.contype === 'f');
    expect(foreignKeys.some((constraint) =>
      String(constraint.definition).includes('FOREIGN KEY (tenant, ticket_id)') &&
      String(constraint.definition).includes('REFERENCES tickets(tenant, ticket_id)')
    )).toBe(true);
    expect(foreignKeys.some((constraint) =>
      String(constraint.definition).includes('FOREIGN KEY (tenant, project_task_id)') &&
      String(constraint.definition).includes('REFERENCES project_tasks(tenant, task_id)')
    )).toBe(true);
  });

  it('T002: creates comment_threads lookup indexes for parent lists and email message IDs', async () => {
    const indexes = await schemaTable('pg_indexes', 'test schema assertion for comment thread migration indexes')
      .select('indexname', 'indexdef')
      .where({ schemaname: 'public', tablename: 'comment_threads' });

    const byName = new Map(indexes.map((index) => [index.indexname, String(index.indexdef)]));

    expect(byName.get('comment_threads_ticket_idx')).toContain(
      'CREATE INDEX comment_threads_ticket_idx ON public.comment_threads USING btree (tenant, ticket_id, last_activity_at DESC)'
    );
    expect(byName.get('comment_threads_task_idx')).toContain(
      'CREATE INDEX comment_threads_task_idx ON public.comment_threads USING btree (tenant, project_task_id, last_activity_at DESC)'
    );

    const emailIndex = byName.get('comment_threads_email_msgid_idx');
    expect(emailIndex).toContain(
      'CREATE INDEX comment_threads_email_msgid_idx ON public.comment_threads USING btree (tenant, email_message_id)'
    );
    expect(emailIndex).toContain('WHERE (email_message_id IS NOT NULL)');
  });

  it('T003: adds comments threading columns and tenant-scoped foreign keys', async () => {
    for (const column of ['thread_id', 'parent_comment_id', 'deleted_at']) {
      await expect(knex.schema.hasColumn('comments', column)).resolves.toBe(true);
    }

    const columns = await schemaTable('information_schema.columns', 'test schema assertion for comment thread migration columns')
      .select('column_name', 'is_nullable')
      .where({ table_schema: 'public', table_name: 'comments' })
      .whereIn('column_name', ['thread_id', 'parent_comment_id', 'deleted_at']);

    const nullableByColumn = new Map(columns.map((column) => [column.column_name, column.is_nullable]));
    expect(nullableByColumn.get('parent_comment_id')).toBe('YES');
    expect(nullableByColumn.get('deleted_at')).toBe('YES');

    const foreignKeys = await schemaTable('pg_constraint as c', 'test schema assertion for comment thread migration constraints')
      .join('pg_class as rel', 'rel.oid', 'c.conrelid')
      .select('c.conname', 'c.contype', knex.raw('pg_get_constraintdef(c.oid) as definition'))
      .where('rel.relname', 'comments')
      .where('c.contype', 'f');

    expect(foreignKeys.some((constraint) =>
      constraint.conname === 'comments_thread_fk' &&
      String(constraint.definition).includes('FOREIGN KEY (tenant, thread_id)') &&
      String(constraint.definition).includes('REFERENCES comment_threads(tenant, thread_id)')
    )).toBe(true);
    expect(foreignKeys.some((constraint) =>
      constraint.conname === 'comments_parent_comment_fk' &&
      String(constraint.definition).includes('FOREIGN KEY (tenant, parent_comment_id)') &&
      String(constraint.definition).includes('REFERENCES comments(tenant, comment_id)')
    )).toBe(true);
  });

  it('T004: adds project_task_comments threading columns and tenant-scoped foreign keys', async () => {
    for (const column of ['thread_id', 'parent_comment_id', 'deleted_at']) {
      await expect(knex.schema.hasColumn('project_task_comments', column)).resolves.toBe(true);
    }

    const columns = await schemaTable('information_schema.columns', 'test schema assertion for comment thread migration columns')
      .select('column_name', 'is_nullable')
      .where({ table_schema: 'public', table_name: 'project_task_comments' })
      .whereIn('column_name', ['thread_id', 'parent_comment_id', 'deleted_at']);

    const nullableByColumn = new Map(columns.map((column) => [column.column_name, column.is_nullable]));
    expect(nullableByColumn.get('parent_comment_id')).toBe('YES');
    expect(nullableByColumn.get('deleted_at')).toBe('YES');

    const foreignKeys = await schemaTable('pg_constraint as c', 'test schema assertion for comment thread migration constraints')
      .join('pg_class as rel', 'rel.oid', 'c.conrelid')
      .select('c.conname', 'c.contype', knex.raw('pg_get_constraintdef(c.oid) as definition'))
      .where('rel.relname', 'project_task_comments')
      .where('c.contype', 'f');

    expect(foreignKeys.some((constraint) =>
      constraint.conname === 'project_task_comments_thread_fk' &&
      String(constraint.definition).includes('FOREIGN KEY (tenant, thread_id)') &&
      String(constraint.definition).includes('REFERENCES comment_threads(tenant, thread_id)')
    )).toBe(true);
    expect(foreignKeys.some((constraint) =>
      constraint.conname === 'project_task_comments_parent_comment_fk' &&
      String(constraint.definition).includes('FOREIGN KEY (tenant, parent_comment_id)') &&
      String(constraint.definition).includes('REFERENCES project_task_comments(tenant, task_comment_id)')
    )).toBe(true);
  });

  it('T005: backfills legacy ticket comments into one thread per comment', async () => {
    const context = await ticketUserContext();
    expect(context).toBeTruthy();

    const generated = await knex.raw('SELECT gen_random_uuid() AS comment_id');
    const commentId = generated.rows[0].comment_id;
    const createdAt = '2026-05-13T12:00:00.000Z';

    await knex.schema.alterTable('comments', (table) => {
      table.uuid('thread_id').nullable().alter();
    });

    try {
      await tenantTable(context.tenant, 'comments').insert({
        tenant: context.tenant,
        comment_id: commentId,
        ticket_id: context.ticket_id,
        user_id: context.user_id,
        thread_id: null,
        note: 'Legacy comment inserted without a thread for backfill coverage',
        is_internal: false,
        is_resolution: false,
        created_at: createdAt,
      });

      await commentBackfillMigration.up(knex);

      const comment = await tenantTable(context.tenant, 'comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: commentId })
        .first();
      expect(comment?.thread_id).toBe(commentId);

      const thread = await tenantTable(context.tenant, 'comment_threads')
        .select('thread_id', 'ticket_id', 'root_comment_id', 'is_internal', 'reply_count', 'created_by')
        .where({ tenant: context.tenant, thread_id: commentId })
        .first();
      expect(thread).toMatchObject({
        thread_id: commentId,
        ticket_id: context.ticket_id,
        root_comment_id: commentId,
        is_internal: false,
        reply_count: 0,
        created_by: context.user_id,
      });
    } finally {
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: commentId }).delete();
      await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: commentId }).delete();
      await knex.schema.alterTable('comments', (table) => {
        table.uuid('thread_id').notNullable().alter();
      });
    }
  });

  it('T006: backfills comment thread email_message_id from comment email metadata', async () => {
    const context = await ticketUserContext();
    expect(context).toBeTruthy();

    const generated = await knex.raw('SELECT gen_random_uuid() AS comment_id');
    const commentId = generated.rows[0].comment_id;
    const messageId = '<legacy-comment@example.test>';

    await knex.schema.alterTable('comments', (table) => {
      table.uuid('thread_id').nullable().alter();
    });

    try {
      await tenantTable(context.tenant, 'comments').insert({
        tenant: context.tenant,
        comment_id: commentId,
        ticket_id: context.ticket_id,
        user_id: context.user_id,
        thread_id: null,
        note: 'Legacy email comment inserted without a thread for metadata backfill coverage',
        is_internal: false,
        is_resolution: false,
        metadata: { email: { messageId } },
      });

      await commentBackfillMigration.up(knex);

      const thread = await tenantTable(context.tenant, 'comment_threads')
        .select('email_message_id')
        .where({ tenant: context.tenant, thread_id: commentId })
        .first();
      expect(thread?.email_message_id).toBe(messageId);
    } finally {
      await tenantTable(context.tenant, 'comments').where({ tenant: context.tenant, comment_id: commentId }).delete();
      await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: commentId }).delete();
      await knex.schema.alterTable('comments', (table) => {
        table.uuid('thread_id').notNullable().alter();
      });
    }
  });

  it('T007: rerunning ticket and task backfills does not duplicate threads', async () => {
    const before = await tenantDb(knex, '__test_migration_idempotency__')
      .unscoped('comment_threads', 'backfill idempotency compares all comment thread rows before rerun')
      .count<{ count: string }[]>({ count: '*' })
      .first();
    const beforeCount = Number(before?.count ?? 0);

    await commentBackfillMigration.up(knex);
    await taskCommentBackfillMigration.up(knex);

    const after = await tenantDb(knex, '__test_migration_idempotency__')
      .unscoped('comment_threads', 'backfill idempotency compares all comment thread rows after rerun')
      .count<{ count: string }[]>({ count: '*' })
      .first();
    const afterCount = Number(after?.count ?? 0);

    expect(afterCount).toBe(beforeCount);
  });

  it('T008: backfills legacy project task comments into one thread per comment', async () => {
    const context = await taskUserContext();
    expect(context).toBeTruthy();

    const generated = await knex.raw('SELECT gen_random_uuid() AS task_comment_id');
    const taskCommentId = generated.rows[0].task_comment_id;
    const createdAt = '2026-05-13T12:05:00.000Z';

    await knex.schema.alterTable('project_task_comments', (table) => {
      table.uuid('thread_id').nullable().alter();
    });

    try {
      await tenantTable(context.tenant, 'project_task_comments').insert({
        tenant: context.tenant,
        task_comment_id: taskCommentId,
        task_id: context.task_id,
        user_id: context.user_id,
        author_type: 'internal',
        thread_id: null,
        note: 'Legacy task comment inserted without a thread for backfill coverage',
        created_at: createdAt,
      });

      await taskCommentBackfillMigration.up(knex);

      const comment = await tenantTable(context.tenant, 'project_task_comments')
        .select('thread_id')
        .where({ tenant: context.tenant, task_comment_id: taskCommentId })
        .first();
      expect(comment?.thread_id).toBe(taskCommentId);

      const thread = await tenantTable(context.tenant, 'comment_threads')
        .select('thread_id', 'project_task_id', 'root_comment_id', 'is_internal', 'reply_count', 'created_by')
        .where({ tenant: context.tenant, thread_id: taskCommentId })
        .first();
      expect(thread).toMatchObject({
        thread_id: taskCommentId,
        project_task_id: context.task_id,
        root_comment_id: taskCommentId,
        is_internal: false,
        reply_count: 0,
        created_by: context.user_id,
      });
    } finally {
      await tenantTable(context.tenant, 'project_task_comments').where({ tenant: context.tenant, task_comment_id: taskCommentId }).delete();
      await tenantTable(context.tenant, 'comment_threads').where({ tenant: context.tenant, thread_id: taskCommentId }).delete();
      await knex.schema.alterTable('project_task_comments', (table) => {
        table.uuid('thread_id').notNullable().alter();
      });
    }
  });

  it('T009: rejects null thread_id inserts after NOT NULL enforcement', async () => {
    const ticketContext = await ticketUserContext();
    expect(ticketContext).toBeTruthy();

    const taskContext = await taskUserContext();
    expect(taskContext).toBeTruthy();

    const ids = await knex.raw(`
      SELECT
        gen_random_uuid() AS comment_id,
        gen_random_uuid() AS task_comment_id
    `);

    await expect(tenantTable(ticketContext.tenant, 'comments').insert({
      tenant: ticketContext.tenant,
      comment_id: ids.rows[0].comment_id,
      ticket_id: ticketContext.ticket_id,
      user_id: ticketContext.user_id,
      thread_id: null,
      note: 'Invalid comment without a thread',
      is_internal: false,
      is_resolution: false,
    })).rejects.toThrow(/null value in column "thread_id"/);

    await expect(tenantTable(taskContext.tenant, 'project_task_comments').insert({
      tenant: taskContext.tenant,
      task_comment_id: ids.rows[0].task_comment_id,
      task_id: taskContext.task_id,
      user_id: taskContext.user_id,
      author_type: 'internal',
      thread_id: null,
      note: 'Invalid task comment without a thread',
    })).rejects.toThrow(/null value in column "thread_id"/);
  });

  it('T010: adds comment_thread_id linkage to email_sending_logs', async () => {
    await expect(knex.schema.hasColumn('email_sending_logs', 'comment_thread_id')).resolves.toBe(true);

    const tenantColumn = await knex.schema.hasColumn('email_sending_logs', 'tenant') ? 'tenant' : 'tenant_id';
    const foreignKeys = await schemaTable('pg_constraint as c', 'test schema assertion for comment thread migration constraints')
      .join('pg_class as rel', 'rel.oid', 'c.conrelid')
      .select('c.conname', 'c.contype', knex.raw('pg_get_constraintdef(c.oid) as definition'))
      .where('rel.relname', 'email_sending_logs')
      .where('c.contype', 'f');

    expect(foreignKeys.some((constraint) =>
      constraint.conname === 'email_sending_logs_comment_thread_fk' &&
      String(constraint.definition).includes(`FOREIGN KEY (${tenantColumn}, comment_thread_id)`) &&
      String(constraint.definition).includes('REFERENCES comment_threads(tenant, thread_id)')
    )).toBe(true);

    const index = await schemaTable('pg_indexes', 'test schema assertion for comment thread migration indexes')
      .select('indexdef')
      .where({
        schemaname: 'public',
        tablename: 'email_sending_logs',
        indexname: 'idx_email_sending_logs_tenant_comment_thread',
      })
      .first();
    expect(String(index?.indexdef)).toContain(`(${tenantColumn}, comment_thread_id, created_at DESC)`);
    expect(String(index?.indexdef)).toContain('WHERE (comment_thread_id IS NOT NULL)');
  });

  it('T072: deleting a ticket cascades to comment_threads', async () => {
    const discoveryDb = tenantDb(knex, '__test_discovery__');
    const contextQuery = discoveryDb.unscoped(
      'tickets as t',
      'test discovery of seeded ticket cascade context for comment thread migration'
    );
    discoveryDb.tenantJoin(contextQuery, 'statuses as s', 's.tenant', 't.tenant');
    discoveryDb.tenantJoin(contextQuery, 'priorities as p', 'p.tenant', 't.tenant');
    discoveryDb.tenantJoin(contextQuery, 'boards as b', 'b.tenant', 't.tenant');
    discoveryDb.tenantJoin(contextQuery, 'clients as c', 'c.tenant', 't.tenant');
    const context = await contextQuery
      .select('t.tenant', 's.status_id', 'p.priority_id', 'b.board_id', 'c.client_id')
      .first();
    expect(context).toBeTruthy();

    const generated = await knex.raw(`
      SELECT
        gen_random_uuid() AS ticket_id,
        gen_random_uuid() AS thread_id,
        gen_random_uuid() AS root_comment_id
    `);
    const rollback = new Error('rollback T072');

    await knex.transaction(async (trx) => {
      const trxTenantDb = tenantDb(trx, context.tenant);
      await trxTenantDb.table('tickets').insert({
        tenant: context.tenant,
        ticket_id: generated.rows[0].ticket_id,
        ticket_number: `T072-${Date.now()}`,
        title: 'T072 cascade ticket',
        status_id: context.status_id,
        priority_id: context.priority_id,
        board_id: context.board_id,
        client_id: context.client_id,
        entered_at: new Date(),
        updated_at: new Date(),
      });

      await trxTenantDb.table('comment_threads').insert({
        tenant: context.tenant,
        thread_id: generated.rows[0].thread_id,
        ticket_id: generated.rows[0].ticket_id,
        root_comment_id: generated.rows[0].root_comment_id,
        is_internal: false,
        reply_count: 0,
      });

      await trxTenantDb.table('tickets')
        .where({ tenant: context.tenant, ticket_id: generated.rows[0].ticket_id })
        .delete();

      const thread = await trxTenantDb.table('comment_threads')
        .where({ tenant: context.tenant, thread_id: generated.rows[0].thread_id })
        .first();
      expect(thread).toBeUndefined();

      throw rollback;
    }).catch((error) => {
      if (error !== rollback) {
        throw error;
      }
    });
  });

  it('T073: deleting a project task cascades to comment_threads', async () => {
    const discoveryDb = tenantDb(knex, '__test_discovery__');
    const contextQuery = discoveryDb.unscoped(
      'project_phases as pp',
      'test discovery of seeded project task cascade context for comment thread migration'
    );
    discoveryDb.tenantJoin(contextQuery, 'project_status_mappings as psm', 'psm.project_id', 'pp.project_id');
    const context = await contextQuery
      .select('pp.tenant', 'pp.phase_id', 'psm.project_status_mapping_id')
      .first();
    expect(context).toBeTruthy();

    const generated = await knex.raw(`
      SELECT
        gen_random_uuid() AS task_id,
        gen_random_uuid() AS thread_id,
        gen_random_uuid() AS root_comment_id
    `);
    const rollback = new Error('rollback T073');

    await knex.transaction(async (trx) => {
      const trxTenantDb = tenantDb(trx, context.tenant);
      await trxTenantDb.table('project_tasks').insert({
        tenant: context.tenant,
        task_id: generated.rows[0].task_id,
        phase_id: context.phase_id,
        task_name: 'T073 cascade task',
        project_status_mapping_id: context.project_status_mapping_id,
        wbs_code: 'T073',
      });

      await trxTenantDb.table('comment_threads').insert({
        tenant: context.tenant,
        thread_id: generated.rows[0].thread_id,
        project_task_id: generated.rows[0].task_id,
        root_comment_id: generated.rows[0].root_comment_id,
        is_internal: false,
        reply_count: 0,
      });

      await trxTenantDb.table('project_tasks')
        .where({ tenant: context.tenant, task_id: generated.rows[0].task_id })
        .delete();

      const thread = await trxTenantDb.table('comment_threads')
        .where({ tenant: context.tenant, thread_id: generated.rows[0].thread_id })
        .first();
      expect(thread).toBeUndefined();

      throw rollback;
    }).catch((error) => {
      if (error !== rollback) {
        throw error;
      }
    });
  });

  it('T074: comment_threads exactly-one parent check rejects missing or double parents', async () => {
    const discoveryDb = tenantDb(knex, '__test_discovery__');
    const contextQuery = discoveryDb.unscoped(
      'tickets as t',
      'test discovery of seeded ticket/task context for comment thread parent check'
    );
    discoveryDb.tenantJoin(contextQuery, 'project_tasks as pt', 'pt.tenant', 't.tenant');
    const context = await contextQuery
      .select('t.tenant', 't.ticket_id', 'pt.task_id')
      .first();
    expect(context).toBeTruthy();

    const generated = await knex.raw(`
      SELECT
        gen_random_uuid() AS no_parent_thread_id,
        gen_random_uuid() AS no_parent_root_id,
        gen_random_uuid() AS double_parent_thread_id,
        gen_random_uuid() AS double_parent_root_id
    `);

    await expect(tenantTable(context.tenant, 'comment_threads').insert({
      tenant: context.tenant,
      thread_id: generated.rows[0].no_parent_thread_id,
      root_comment_id: generated.rows[0].no_parent_root_id,
      is_internal: false,
      reply_count: 0,
    })).rejects.toThrow(/comment_threads_exactly_one_parent_check|violates check constraint/);

    await expect(tenantTable(context.tenant, 'comment_threads').insert({
      tenant: context.tenant,
      thread_id: generated.rows[0].double_parent_thread_id,
      ticket_id: context.ticket_id,
      project_task_id: context.task_id,
      root_comment_id: generated.rows[0].double_parent_root_id,
      is_internal: false,
      reply_count: 0,
    })).rejects.toThrow(/comment_threads_exactly_one_parent_check|violates check constraint/);
  });
});
