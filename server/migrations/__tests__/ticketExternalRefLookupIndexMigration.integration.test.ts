import { afterAll, beforeAll, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const migration = createRequire(import.meta.url)('../20261102120000_add_ticket_external_ref_lookup_index.cjs');
const INDEX = 'tickets_tenant_external_ref_lookup_idx';
let db: Knex;

beforeAll(() => {
  const database = process.env.DB_NAME_SERVER;
  if (!database || ['server', 'production', 'postgres'].includes(database)) {
    throw new Error('An explicit isolated test database is required');
  }
  db = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database,
    user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN,
  }, pool: { min: 0, max: 5 } });
});

afterAll(async () => { await db?.destroy(); });

it('creates, repairs, rolls back, and reapplies the selector index on an isolated table', async () => {
  const schema = `ticket_external_ref_${randomUUID().replaceAll('-', '')}`;
  await db.raw('CREATE SCHEMA ??', [schema]);
  const connection = await db.client.acquireConnection();
  const scoped: Knex = {
    raw: (sql: string, bindings?: readonly unknown[]) => db.raw(sql, bindings as any).connection(connection),
  } as Knex;
  let blocker: Knex.Transaction | undefined;
  try {
    await scoped.raw('SET search_path TO ??, public', [schema]);
    await scoped.raw('CREATE TABLE tickets (tenant uuid NOT NULL, attributes jsonb NOT NULL)');
    if (process.env.TEST_DB_BACKEND === 'citus') {
      await scoped.raw("SELECT create_distributed_table(?, 'tenant')", [`${schema}.tickets`]);
    }
    await scoped.raw("INSERT INTO tickets VALUES (?::uuid, '{\"external_ref\":\"ref-1\"}')", [randomUUID()]);

    await migration.up(scoped);
    await migration.up(scoped);
    const validIndex = async () => {
      const { rows } = await scoped.raw(`
        SELECT i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = ? AND i.indrelid = 'tickets'::regclass
      `, [INDEX]);
      return rows[0];
    };
    expect(await validIndex()).toMatchObject({ indisvalid: true, indisready: true });
    expect((await validIndex()).definition).toMatch(/tenant.*attributes.*external_ref/i);

    // Hold a pre-build snapshot so CREATE INDEX CONCURRENTLY reaches its
    // wait-for-old-snapshots phase, then cancel it to produce a real invalid index.
    await migration.down(scoped);
    blocker = await db.transaction();
    await blocker.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await blocker.raw('SET search_path TO ??, public', [schema]);
    await blocker('tickets').select('*');
    const interrupted = migration.up(scoped).then(() => null, (error: unknown) => error);
    let builderPid: number | undefined;
    await expect.poll(async () => {
      const { rows } = await db.raw(`
        SELECT p.pid FROM pg_stat_progress_create_index p
        JOIN pg_class c ON c.oid = p.index_relid WHERE c.relname = ?
      `, [INDEX]);
      builderPid = rows[0]?.pid;
      return builderPid;
    }, { timeout: 20_000 }).toBeTruthy();
    await db.raw('SELECT pg_cancel_backend(?::integer)', [builderPid]);
    expect(await interrupted).toBeTruthy();
    const invalid = await scoped.raw(`
      SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ? AND NOT i.indisvalid
    `, [INDEX]);
    expect(invalid.rows).toHaveLength(1);
    await blocker.rollback();
    blocker = undefined;

    await migration.up(scoped);
    expect(await validIndex()).toMatchObject({ indisvalid: true, indisready: true });
    await migration.down(scoped);
    await migration.down(scoped);
    expect(await validIndex()).toBeUndefined();
    await migration.up(scoped);
    expect(await validIndex()).toMatchObject({ indisvalid: true, indisready: true });
  } finally {
    await blocker?.rollback().catch(() => undefined);
    await scoped.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX}`).catch(() => undefined);
    await db.client.releaseConnection(connection);
    await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]);
  }
}, 60_000);
