import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require('../20261124010000_add_audience_to_documents_and_folders.cjs');

describe('documents and folders audience migration (S1)', () => {
  let db: Knex;
  let scratch: string;
  const tenant = randomUUID();
  // Rows that already exist when the tables are distributed. On Citus, create_distributed_table
  // copies them to the shards but leaves the coordinator heap holding a stale copy, which the
  // migration must truncate (closure fully distributed) before it adds and validates the CHECK.
  const preTenant = randomUUID();
  const preIds = { visibleDoc: randomUUID(), hiddenDoc: randomUUID(), visibleFolder: randomUUID() };
  const citus = process.env.TEST_DB_BACKEND === 'citus';
  let heapBefore: Record<string, number> = {};
  const seatUser = randomUUID();
  const revokedUser = randomUUID();
  const plainUser = randomUUID();
  const ids = {
    visibleDoc: randomUUID(), hiddenDoc: randomUUID(), seatDoc: randomUUID(),
    seatVisibleDoc: randomUUID(), revokedDoc: randomUUID(),
    visibleFolder: randomUUID(), hiddenFolder: randomUUID(), seatFolder: randomUUID(),
  };

  const docAudiences = async () => Object.fromEntries(
    (await db('documents').where({ tenant }).select('document_id', 'audience'))
      .map((r) => [r.document_id, r.audience]));
  const folderAudiences = async () => Object.fromEntries(
    (await db('document_folders').where({ tenant }).select('folder_id', 'audience'))
      .map((r) => [r.folder_id, r.audience]));

  const heapBytes = async () => Object.fromEntries(await Promise.all(['documents', 'document_folders'].map(
    async (table) => [table, Number((await db.raw('SELECT pg_relation_size(?::regclass) AS b', [table])).rows[0].b)])));

  beforeAll(async () => {
    wireLocalTestDbEnv();
    scratch = mkdtempSync(path.join(tmpdir(), 'document-audience-'));
    // Minimal pre-migration shape: the columns this migration reads, no `audience`.
    writeFileSync(path.join(scratch, '20261124000000_fixture.cjs'), `
      exports.config = { transaction: false };
      exports.up = async (knex) => {
        await knex.raw(\`
          CREATE TABLE tenants (tenant uuid PRIMARY KEY);
          CREATE TABLE documents (tenant uuid, document_id uuid, created_by uuid, is_client_visible boolean NOT NULL DEFAULT false,
            PRIMARY KEY (tenant, document_id));
          CREATE TABLE document_folders (tenant uuid, folder_id uuid, is_client_visible boolean NOT NULL DEFAULT false,
            PRIMARY KEY (tenant, folder_id));
          CREATE TABLE co_managed_seat_assignments (tenant uuid, assignment_id uuid, user_id uuid, state text,
            PRIMARY KEY (tenant, assignment_id));
          INSERT INTO documents (tenant, document_id, is_client_visible) VALUES
            ('${preTenant}', '${preIds.visibleDoc}', true), ('${preTenant}', '${preIds.hiddenDoc}', false);
          INSERT INTO document_folders (tenant, folder_id, is_client_visible) VALUES
            ('${preTenant}', '${preIds.visibleFolder}', true);
        \`);
        if (process.env.TEST_DB_BACKEND === 'citus') {
          await knex.raw("SELECT create_distributed_table('tenants', 'tenant')");
          for (const t of ['documents', 'document_folders', 'co_managed_seat_assignments']) {
            await knex.raw("SELECT create_distributed_table(?, 'tenant', colocate_with => 'tenants')", [t]);
          }
        }
      };
      exports.down = async () => {};
    `);
    db = await createTestDbConnection({ databaseName: 'document_audience_migration_test', migrationsDir: scratch, runSeeds: false });

    await db('tenants').insert({ tenant });
    await db('co_managed_seat_assignments').insert([
      { tenant, assignment_id: randomUUID(), user_id: seatUser, state: 'active' },
      { tenant, assignment_id: randomUUID(), user_id: revokedUser, state: 'revoked' },
    ]);
    await db('documents').insert([
      { tenant, document_id: ids.visibleDoc, created_by: plainUser, is_client_visible: true },
      { tenant, document_id: ids.hiddenDoc, created_by: plainUser, is_client_visible: false },
      { tenant, document_id: ids.seatDoc, created_by: seatUser, is_client_visible: false },
      { tenant, document_id: ids.seatVisibleDoc, created_by: seatUser, is_client_visible: true },
      { tenant, document_id: ids.revokedDoc, created_by: revokedUser, is_client_visible: false },
    ]);
    await db('document_folders').insert([
      { tenant, folder_id: ids.visibleFolder, is_client_visible: true },
      { tenant, folder_id: ids.hiddenFolder, is_client_visible: false },
    ]);
    heapBefore = await heapBytes();
    await migration.up(db);
  }, 300_000);

  afterAll(async () => {
    try {
      await db?.destroy();
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('backfills documents from client visibility and seat authorship', async () => {
    expect(await docAudiences()).toEqual({
      [ids.visibleDoc]: 'requester',
      [ids.hiddenDoc]: 'organization_private',
      [ids.seatDoc]: 'shared_it',
      [ids.seatVisibleDoc]: 'requester',
      [ids.revokedDoc]: 'organization_private',
    });
  });

  it('backfills folders from client visibility and never uses shared_it', async () => {
    expect(await folderAudiences()).toEqual({
      [ids.visibleFolder]: 'requester',
      [ids.hiddenFolder]: 'organization_private',
    });
  });

  it('backfills rows present at distribution and clears the stale coordinator heap on Citus', async () => {
    expect(Object.fromEntries(
      (await db('documents').where({ tenant: preTenant }).select('document_id', 'audience')).map((r) => [r.document_id, r.audience]),
    )).toEqual({ [preIds.visibleDoc]: 'requester', [preIds.hiddenDoc]: 'organization_private' });
    expect(await db('document_folders').where({ tenant: preTenant }).first('audience')).toEqual({ audience: 'requester' });

    expect(heapBefore.documents).toBeGreaterThan(0);
    expect(heapBefore.document_folders).toBeGreaterThan(0);
    // Citus: stranded pre-distribution heap truncated. Plain Postgres: the heap is the table; never truncated.
    const after = await heapBytes();
    if (citus) {
      expect(after).toEqual({ documents: 0, document_folders: 0 });
    } else {
      expect(after.documents).toBeGreaterThan(0);
      expect(after.document_folders).toBeGreaterThan(0);
    }
  });

  it('keeps is_client_visible equal to audience = requester on both tables', async () => {
    for (const table of ['documents', 'document_folders']) {
      const { rows } = await db.raw(
        `SELECT count(*)::int AS n FROM ${table} WHERE is_client_visible IS DISTINCT FROM (audience = 'requester') AND audience <> 'shared_it'`);
      expect(rows[0].n).toBe(0);
    }
  });

  it('defaults to organization_private, rejects unknown audiences, and the checks are validated', async () => {
    for (const table of ['documents', 'document_folders']) {
      const { rows } = await db.raw(
        `SELECT column_default FROM information_schema.columns WHERE table_name = ? AND column_name = 'audience'`, [table]);
      expect(rows[0].column_default).toContain('organization_private');
      const check = await db.raw(
        `SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`, [`${table}_audience_check`, table]);
      expect(check.rows).toEqual([{ convalidated: true }]);
    }
    await expect(db('documents').insert({ tenant, document_id: randomUUID(), audience: 'bogus' })).rejects.toThrow(/audience_check/);
    await expect(db('document_folders').insert({ tenant, folder_id: randomUUID(), audience: 'bogus' })).rejects.toThrow(/audience_check/);
  });

  it('is a no-op when run a second time', async () => {
    const docs = await docAudiences();
    const folders = await folderAudiences();
    await migration.up(db);
    expect(await docAudiences()).toEqual(docs);
    expect(await folderAudiences()).toEqual(folders);
  });

  it('rolls back and re-applies', async () => {
    await migration.down(db);
    expect(await db.schema.hasColumn('documents', 'audience')).toBe(false);
    expect(await db.schema.hasColumn('document_folders', 'audience')).toBe(false);
    await migration.down(db);
    await migration.up(db);
    expect((await docAudiences())[ids.seatDoc]).toBe('shared_it');
  });
});
