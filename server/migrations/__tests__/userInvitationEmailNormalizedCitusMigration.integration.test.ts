import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '..', '20261103130000_add_normalized_email_to_user_invitations.cjs'));
const citusConnectionString = process.env.TEST_CITUS_DATABASE_URL;
const databaseName = process.env.TEST_CITUS_DATABASE_NAME ?? `user_invite_citus_${randomUUID().replaceAll('-', '')}`;
if (!/^user_invite_citus_[a-f0-9]{16,32}$/.test(databaseName)) {
  throw new Error('TEST_CITUS_DATABASE_NAME must be a unique user_invite_citus_<hex> name.');
}
let admin: Knex | undefined;
let db: Knex | undefined;
let workerAdmin: Knex | undefined;
let coordinatorDatabaseCreated = false;
let workerDatabaseCreated = false;

describe.skipIf(!citusConnectionString)('user invitation normalized email migration on Citus', () => {
  beforeAll(async () => {
    const adminUrl = new URL(citusConnectionString!);
    adminUrl.pathname = '/postgres';
    admin = knex({ client: 'pg', connection: adminUrl.toString(), pool: { min: 0, max: 1 } });
    await admin.raw('CREATE DATABASE ??', [databaseName]);
    coordinatorDatabaseCreated = true;

    const testUrl = new URL(citusConnectionString!);
    testUrl.pathname = `/${databaseName}`;
    db = knex({ client: 'pg', connection: testUrl.toString(), pool: { min: 0, max: 2 } });
    await db.raw('CREATE EXTENSION citus');
    const nodes = await db.raw('SELECT count(*)::int AS count FROM pg_dist_node WHERE isactive AND groupid <> 0');
    if (nodes.rows[0].count === 0) {
      const workerHost = process.env.TEST_CITUS_WORKER_HOST;
      const workerPort = Number(process.env.TEST_CITUS_WORKER_PORT || 5432);
      const workerDatabaseUrl = process.env.TEST_CITUS_WORKER_DATABASE_URL;
      if (!workerHost || !workerDatabaseUrl) {
        throw new Error('Set TEST_CITUS_WORKER_HOST and TEST_CITUS_WORKER_DATABASE_URL for an isolated Citus worker.');
      }
      const workerAdminUrl = new URL(workerDatabaseUrl);
      workerAdminUrl.pathname = '/postgres';
      workerAdmin = knex({ client: 'pg', connection: workerAdminUrl.toString(), pool: { min: 0, max: 1 } });
      await workerAdmin.raw('CREATE DATABASE ??', [databaseName]);
      workerDatabaseCreated = true;
      const workerDbUrl = new URL(workerDatabaseUrl);
      workerDbUrl.pathname = `/${databaseName}`;
      const workerDb = knex({ client: 'pg', connection: workerDbUrl.toString(), pool: { min: 0, max: 1 } });
      try { await workerDb.raw('CREATE EXTENSION citus'); }
      finally { await workerDb.destroy(); }
      await db.raw('SELECT citus_add_node(?, ?)', [workerHost, workerPort]);
    }
    await db.schema.createTable('user_invitations', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('invitation_id').notNullable().defaultTo(db!.raw('gen_random_uuid()'));
      table.text('email').notNullable();
      table.primary(['tenant', 'invitation_id']);
    });
    await db.raw("SELECT create_distributed_table('user_invitations', 'tenant')");
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    if (admin && coordinatorDatabaseCreated) {
      await admin.raw(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ?`, [databaseName]);
      await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
    }
    await admin?.destroy();
    if (workerAdmin && workerDatabaseCreated) {
      await workerAdmin.raw(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ?`, [databaseName]);
      await workerAdmin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
    }
    await workerAdmin?.destroy();
  });

  it('backfills the distributed table and checks every shard result before catalog synchronization', async () => {
    const tenant = randomUUID();
    await db!('user_invitations').insert({ tenant, email: 'Citus.Invite@Example.test' });

    await migration.up(db!);

    const invitation = await db!('user_invitations').where({ tenant }).first();
    expect(invitation.email_normalized).toBe('citus.invite@example.test');
    const column = await db!.raw(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'user_invitations'
        AND column_name = 'email_normalized'
    `);
    expect(column.rows[0].is_nullable).toBe('NO');
    const distribution = await db!.raw(`
      SELECT count(*)::int AS shards FROM pg_dist_shard
      WHERE logicalrelid = 'user_invitations'::regclass
    `);
    expect(distribution.rows[0].shards).toBeGreaterThan(0);

    await expect(db!('user_invitations').insert({ tenant, email: 'citus.second@example.test', email_normalized: 'citus.second@example.test' }))
      .resolves.toBeDefined();
  }, 120_000);
});
