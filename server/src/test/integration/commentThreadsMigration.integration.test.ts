import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

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
});
