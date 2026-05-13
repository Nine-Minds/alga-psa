import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const commentBackfillMigration = require('../../../migrations/20260513102000_backfill_comment_threads_for_comments.cjs');

describe('comment_threads migrations', () => {
  let knex: Knex;

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

    const constraints = await knex('pg_constraint as c')
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
    const indexes = await knex('pg_indexes')
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

    const columns = await knex('information_schema.columns')
      .select('column_name', 'is_nullable')
      .where({ table_schema: 'public', table_name: 'comments' })
      .whereIn('column_name', ['thread_id', 'parent_comment_id', 'deleted_at']);

    const nullableByColumn = new Map(columns.map((column) => [column.column_name, column.is_nullable]));
    expect(nullableByColumn.get('parent_comment_id')).toBe('YES');
    expect(nullableByColumn.get('deleted_at')).toBe('YES');

    const foreignKeys = await knex('pg_constraint as c')
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

    const columns = await knex('information_schema.columns')
      .select('column_name', 'is_nullable')
      .where({ table_schema: 'public', table_name: 'project_task_comments' })
      .whereIn('column_name', ['thread_id', 'parent_comment_id', 'deleted_at']);

    const nullableByColumn = new Map(columns.map((column) => [column.column_name, column.is_nullable]));
    expect(nullableByColumn.get('parent_comment_id')).toBe('YES');
    expect(nullableByColumn.get('deleted_at')).toBe('YES');

    const foreignKeys = await knex('pg_constraint as c')
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
    const context = await knex('tickets as t')
      .join('users as u', 'u.tenant', 't.tenant')
      .select('t.tenant', 't.ticket_id', 'u.user_id')
      .first();
    expect(context).toBeTruthy();

    const generated = await knex.raw('SELECT gen_random_uuid() AS comment_id');
    const commentId = generated.rows[0].comment_id;
    const createdAt = '2026-05-13T12:00:00.000Z';

    await knex.schema.alterTable('comments', (table) => {
      table.uuid('thread_id').nullable().alter();
    });

    try {
      await knex('comments').insert({
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

      const comment = await knex('comments')
        .select('thread_id')
        .where({ tenant: context.tenant, comment_id: commentId })
        .first();
      expect(comment?.thread_id).toBe(commentId);

      const thread = await knex('comment_threads')
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
      await knex('comments').where({ tenant: context.tenant, comment_id: commentId }).delete();
      await knex('comment_threads').where({ tenant: context.tenant, thread_id: commentId }).delete();
      await knex.schema.alterTable('comments', (table) => {
        table.uuid('thread_id').notNullable().alter();
      });
    }
  });
});
