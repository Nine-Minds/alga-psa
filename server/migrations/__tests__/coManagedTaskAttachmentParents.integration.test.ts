import { afterAll, beforeAll, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const migration = createRequire(import.meta.url)('../20260908220024_add_co_managed_task_attachment_parents.cjs');
const disclosure = createRequire(import.meta.url)('../20260908232516_add_co_managed_task_thread_disclosure.cjs');
const attachments = 'co_management_conversation_attachments';
const archives = 'co_managed_archive_files';
const transfers = 'co_management_thread_transfers';
let db: Knex;
let migrationsDir: string;

beforeAll(async () => {
  wireLocalTestDbEnv();
  migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-attachment-parents-'));
  db = await createTestDbConnection({ databaseName: 'test_task_attachment_parents', migrationsDir, runSeeds: false });
  for (const table of [attachments, archives]) {
    await db.schema.createTable(table, t => {
      t.uuid('tenant').notNullable(); t.uuid('customer_tenant').notNullable(); t.uuid('relationship_id').notNullable();
      t.uuid('ticket_id').notNullable(); t.uuid('thread_id').notNullable(); t.uuid('comment_id').notNullable();
      t.uuid('archive_file_id').notNullable(); t.timestamp('captured_at').defaultTo(db.fn.now());
      t.uuid('draft_operation_id'); t.uuid('disclosure_operation_id');
      t.primary(['tenant', 'archive_file_id']);
    });
    if (process.env.TEST_DB_BACKEND === 'citus') await db.raw("SELECT create_distributed_table(?, 'tenant')", [table]);
  }
  await db.schema.createTable(transfers, t => {
    t.uuid('tenant').notNullable(); t.uuid('operation_id').notNullable(); t.uuid('customer_tenant').notNullable();
    t.uuid('relationship_id').notNullable(); t.uuid('ticket_id').notNullable(); t.uuid('source_thread_id').notNullable();
    t.primary(['tenant', 'operation_id']);
  });
  if (process.env.TEST_DB_BACKEND === 'citus') await db.raw("SELECT create_distributed_table(?, 'tenant')", [transfers]);
}, 60_000);

afterAll(async () => {
  await db?.destroy();
  if (migrationsDir) fs.rmSync(migrationsDir, { recursive: true, force: true });
});

it('migrates distributed attachment parents atomically and retains parent constraints through rollback and replay', async () => {
  const tenant = randomUUID();
  const row = { tenant, customer_tenant: randomUUID(), relationship_id: randomUUID(), ticket_id: randomUUID(),
    thread_id: randomUUID(), comment_id: randomUUID(), archive_file_id: randomUUID() };
  for (const table of [attachments, archives]) await db(table).insert(row);
  // Knex runs this migration in a transaction. Parallel shard DDL followed by
  // CREATE FUNCTION must succeed in that same transaction on Citus.
  await db.transaction(trx => migration.up(trx));
  await db.transaction(trx => migration.up(trx));
  for (const table of [attachments, archives]) {
    expect(await db(table).where({ tenant }).first()).toMatchObject({ ...row, project_task_id: null });
    await expect(db(table).insert({ ...row, archive_file_id: randomUUID(), ticket_id: null }))
      .rejects.toMatchObject({ code: '23514' });
    await expect(db(table).insert({ ...row, archive_file_id: randomUUID(), project_task_id: randomUUID() }))
      .rejects.toMatchObject({ code: '23514' });
  }
  const task = { ...row, archive_file_id: randomUUID(), ticket_id: null, project_task_id: randomUUID() };
  for (const table of [attachments, archives]) await db(table).insert(task);
  await expect(db(attachments).insert({ ...task, archive_file_id: randomUUID(), draft_operation_id: randomUUID() }))
    .rejects.toMatchObject({ code: '23514' });
  if (process.env.TEST_DB_BACKEND !== 'citus') {
    await expect(db(archives).where({ tenant, archive_file_id: task.archive_file_id }).update({ project_task_id: randomUUID() }))
      .rejects.toMatchObject({ code: '23514' });
  }
  await expect(db.transaction(trx => migration.down(trx))).rejects.toThrow('Cannot discard retained task attachments');
  for (const table of [attachments, archives]) await db(table).where({ tenant, archive_file_id: task.archive_file_id }).delete();
  await db.transaction(trx => migration.down(trx));
  for (const table of [attachments, archives]) {
    expect(await db.schema.hasColumn(table, 'project_task_id')).toBe(false);
    expect(await db(table).where({ tenant }).first()).toMatchObject(row);
  }
  await db.transaction(trx => migration.up(trx));
  // The following migration relaxes task disclosure, but still forbids drafts
  // and changes to retained thread-transfer identity.
  await db.transaction(trx => disclosure.up(trx));
  await db.transaction(trx => disclosure.up(trx));
  const transfer = { tenant, operation_id: randomUUID(), customer_tenant: row.customer_tenant,
    relationship_id: row.relationship_id, ticket_id: null, project_task_id: task.project_task_id,
    source_thread_id: randomUUID() };
  await db(transfers).insert(transfer);
  await db(attachments).insert({ ...task, disclosure_operation_id: transfer.operation_id });
  await expect(db(transfers).insert({ ...transfer, operation_id: randomUUID(), project_task_id: null }))
    .rejects.toMatchObject({ code: '23514' });
  await expect(db(attachments).insert({ ...task, archive_file_id: randomUUID(), draft_operation_id: randomUUID() }))
    .rejects.toMatchObject({ code: '23514' });
  if (process.env.TEST_DB_BACKEND !== 'citus') {
    await expect(db(transfers).where({ tenant, operation_id: transfer.operation_id }).update({ project_task_id: randomUUID() }))
      .rejects.toMatchObject({ code: '23514' });
  }
  await expect(db.transaction(trx => disclosure.down(trx))).rejects.toThrow('Cannot discard retained task disclosure history');
  await db(transfers).where({ tenant }).delete();
  await db(attachments).where({ tenant, archive_file_id: task.archive_file_id }).delete();
  await db.transaction(trx => disclosure.down(trx));
  expect(await db.schema.hasColumn(transfers, 'project_task_id')).toBe(false);
  await db.transaction(trx => disclosure.up(trx));
}, 60_000);
