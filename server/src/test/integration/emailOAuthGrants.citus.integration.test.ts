import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';

const requireCitus = process.env.REQUIRE_CITUS === '1';
const describeCitus = requireCitus ? describe : describe.skip;
const databaseNames = [
  `oauth_grants_citus_${randomUUID().replaceAll('-', '')}`,
  `oauth_grants_partial_${randomUUID().replaceAll('-', '')}`,
];
const appRole = `oauth_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const appPassword = randomUUID();
const host = process.env.CITUS_TEST_HOST || '127.0.0.1';
const port = Number(process.env.CITUS_TEST_PORT || 5433);
let admin: Knex;
let freshDb: Knex;
let partialDb: Knex;
let appDb: Knex;
let adminPassword: string;

async function assertCoordinatorReachable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      reject(new Error(
        `REQUIRE_CITUS=1 but the Citus coordinator at ${host}:${port} is unavailable: ${error.message}`
      ));
    });
    socket.setTimeout(1_000, () => {
      socket.destroy();
      reject(new Error(`REQUIRE_CITUS=1 but the Citus coordinator at ${host}:${port} did not respond`));
    });
  });
}

function connection(database: string, user = 'postgres', password?: string): Knex {
  return knex({
    client: 'pg',
    connection: {
      host,
      port,
      user,
      password,
      database,
      connectionTimeoutMillis: 5_000,
    },
    pool: { min: 0, max: 4 },
  });
}

async function createCitusDatabase(databaseName: string): Promise<Knex> {
  await admin.raw('CREATE DATABASE ??', [databaseName]);
  const db = connection(databaseName, 'postgres', adminPassword);
  try {
    await db.raw('CREATE EXTENSION citus');
    const version = await db.raw('SELECT citus_version() AS version');
    expect(version.rows[0].version).toContain('Citus');
    await db.raw('SELECT citus_set_coordinator_host(?, 5432)', ['localhost']);
    await db.raw("SELECT citus_set_node_property('localhost', 5432, 'shouldhaveshards', true)");
    await db.raw(`CREATE ROLE ?? LOGIN PASSWORD '${appPassword}'`, [appRole]).catch(async (error: { code?: string }) => {
      if (error.code !== '42710') throw error;
    });
    await db.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}`);
    await db.raw('CREATE TABLE tenants (tenant uuid PRIMARY KEY)');
    await db.raw("SELECT create_distributed_table('tenants', 'tenant')");
    return db;
  } catch (error) {
    await db.destroy();
    throw new Error(`REQUIRE_CITUS=1 but database ${databaseName} could not be prepared as Citus: ${String(error)}`);
  }
}

async function prepareInterruptedCreationState(db: Knex): Promise<void> {
  // Models a non-transactional migration stopping after CREATE TABLE and the
  // index, before create_distributed_table and the post-distribution FK.
  await db.schema.createTable('email_oauth_grants', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('id').notNullable();
    table.uuid('provider_id').notNullable();
    table.uuid('initiated_by_user_id').notNullable();
    table.text('purpose').notNullable();
    table.text('redirect_uri').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('consumed_at', { useTz: true }).nullable();
    table.primary(['tenant', 'id']);
  });
  await db.raw(
    'CREATE INDEX email_oauth_grants_tenant_provider_id_expires_at_index ON email_oauth_grants (tenant, provider_id, expires_at)'
  );
}

async function expectDistributedWithTenantFk(db: Knex): Promise<void> {
  const catalog = await db.raw(`
    SELECT grants.partmethod AS method,
           grants.colocationid = tenants.colocationid AS colocated,
           tables.distribution_column
      FROM pg_dist_partition AS grants
      JOIN citus_tables AS tables
        ON tables.table_name::text = 'email_oauth_grants'
      JOIN pg_dist_partition AS tenants
        ON tenants.logicalrelid = 'tenants'::regclass
     WHERE grants.logicalrelid = 'email_oauth_grants'::regclass
  `);
  expect(catalog.rows).toHaveLength(1);
  expect(catalog.rows[0]).toMatchObject({ method: 'h', colocated: true });
  expect(catalog.rows[0].distribution_column).toBe('tenant');

  const fk = await db.raw(`
    SELECT conname, confdeltype
      FROM pg_constraint
     WHERE conrelid = 'email_oauth_grants'::regclass
       AND contype = 'f'
       AND confrelid = 'tenants'::regclass
  `);
  expect(fk.rows).toEqual([{ conname: 'email_oauth_grants_tenant_foreign', confdeltype: 'c' }]);
}

describeCitus('email OAuth grants migration (Citus)', () => {
  beforeAll(async () => {
    await assertCoordinatorReachable();
    let secretFilePassword: string | undefined;
    for (const secretsDir of ['/run/secrets', path.resolve(process.cwd(), '../secrets')]) {
      try {
        secretFilePassword = fs.readFileSync(path.join(secretsDir, 'postgres_password'), 'utf8').trim();
        break;
      } catch {
        // Keep trying the local secrets directory, then use explicit test env/default.
      }
    }
    adminPassword = process.env.CITUS_TEST_ADMIN_PASSWORD
      || process.env.DB_PASSWORD_ADMIN
      || secretFilePassword
      || 'postgres';
    admin = connection('postgres', 'postgres', adminPassword);
    try {
      await admin.raw('SELECT version()');
      freshDb = await createCitusDatabase(databaseNames[0]);
      partialDb = await createCitusDatabase(databaseNames[1]);
      appDb = connection(databaseNames[0], appRole, appPassword);
      await prepareInterruptedCreationState(partialDb);
    } catch (error) {
      throw new Error(`Citus migration verification is required but setup failed: ${String(error)}`);
    }
  }, 60_000);

  afterAll(async () => {
    await Promise.all([appDb?.destroy(), freshDb?.destroy(), partialDb?.destroy()]);
    if (!admin) return;
    for (const databaseName of databaseNames) {
      await admin.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [databaseName]);
    }
    await admin.raw('DROP ROLE IF EXISTS ??', [appRole]);
    await admin.destroy();
  });

  it('distributes before adding the FK, retries fresh and interrupted states, and preserves role behavior', async () => {
    const migration = await import('../../../migrations/20261101090000_create_email_oauth_grants.cjs');

    await migration.up(freshDb);
    await migration.up(freshDb);
    await expectDistributedWithTenantFk(freshDb);
    expect(await freshDb.raw(
      "SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid = 'email_oauth_grants'::regclass"
    ).then((result) => result.rows[0].count)).toBe(2);
    expect(await freshDb.raw(
      "SELECT count(*)::int AS count FROM pg_indexes WHERE tablename = 'email_oauth_grants' AND indexname = 'email_oauth_grants_tenant_provider_id_expires_at_index'"
    ).then((result) => result.rows[0].count)).toBe(1);

    const tenant = randomUUID();
    await freshDb('tenants').insert({ tenant });
    await expect(appDb('email_oauth_grants').insert({
      tenant: randomUUID(),
      id: randomUUID(),
      provider_id: randomUUID(),
      initiated_by_user_id: randomUUID(),
      purpose: 'reconnect',
      redirect_uri: 'https://psa.example.test/callback',
      expires_at: new Date(Date.now() + 60_000),
    })).rejects.toMatchObject({ code: '23503' });

    const grantId = randomUUID();
    await appDb('email_oauth_grants').insert({
      tenant,
      id: grantId,
      provider_id: randomUUID(),
      initiated_by_user_id: randomUUID(),
      purpose: 'reconnect',
      redirect_uri: 'https://psa.example.test/callback',
      expires_at: new Date(Date.now() + 60_000),
    });
    const consume = () => appDb('email_oauth_grants')
      .where({ tenant, id: grantId })
      .whereNull('consumed_at')
      .where('expires_at', '>', appDb.fn.now())
      .update({ consumed_at: appDb.fn.now() })
      .returning('id');
    const outcomes = await Promise.all([consume(), consume()]);
    expect(outcomes.flat()).toHaveLength(1);

    await migration.up(partialDb);
    await migration.up(partialDb);
    await expectDistributedWithTenantFk(partialDb);
  }, 30_000);
});
