import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tenantDeletionOrder } from '@alga-psa/db/tenantTableManifest';

type Migration = { up(db: Knex): Promise<void>; down(db: Knex): Promise<void> };
const require = createRequire(import.meta.url);
const load = (name: string): Migration => require(fileURLToPath(new URL(`../../../../migrations/${name}.cjs`, import.meta.url)));
const create = load('20261103120000_create_rmm_condition_lifecycle');
const order = load('20261103130000_order_rmm_condition_delivery');
const ownership = load('20261103140000_index_rmm_condition_alert_ownership');
const schema = `rmm_migration_${randomUUID().replaceAll('-', '')}`;
const shadowSchema = `${schema}_shadow`;
const indexNames = ['idx_rmm_condition_transition_order', 'idx_rmm_condition_states_alert_owner'];
let db: Knex;

beforeAll(async () => {
  if (!process.env.DB_USER_ADMIN || !process.env.DB_PASSWORD_ADMIN) {
    throw new Error('RMM migration test requires isolated workspace DB credentials');
  }
  db = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN,
      database: process.env.TEST_DB_NAME || 'test_database',
    },
    searchPath: [schema, shadowSchema, 'public'], pool: { min: 0, max: 1 },
  });
  await db.raw('CREATE SCHEMA ??', [schema]);
  await db.raw('CREATE SCHEMA ??', [shadowSchema]);
  await db.schema.withSchema(shadowSchema).createTable('unrelated', table => table.integer('id'));
  // A later search-path schema must neither satisfy the validity probe nor
  // become the target of a concurrent index rollback.
  for (const name of indexNames) {
    await db.raw('CREATE INDEX ?? ON ??.unrelated (id)', [name, shadowSchema]);
  }
  await db.schema.createTable('rmm_integrations', table => {
    table.uuid('tenant').notNullable();
    table.uuid('integration_id').notNullable();
    table.primary(['tenant', 'integration_id']);
  });
});

afterAll(async () => {
  if (db) {
    try {
      await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]);
      await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [shadowSchema]);
    }
    finally { await db.destroy(); }
  }
});

it('preserves tenant-isolated outbox order across batches, reruns, and index rollback', async () => {
  const shadowIndexes = () => db.raw(`SELECT c.oid, c.relname, i.indisvalid FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ? ORDER BY c.relname`, [shadowSchema]);
  const beforeShadow = await shadowIndexes();
  expect(beforeShadow.rows.map((row: { relname: string }) => row.relname)).toEqual([...indexNames].sort());
  await db.transaction(trx => create.up(trx));
  // The first migration must also be safe to resume after it created the tables.
  await db.transaction(trx => create.up(trx));
  const citus = await db.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus'");
  if (citus.rows.length) {
    const local = await db.raw("SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'rmm_condition_states'::regclass");
    expect(local.rows).toHaveLength(0);
    await db.transaction(trx => create.down(trx));
    await db.raw("SELECT create_distributed_table(?, 'tenant')", [`${schema}.rmm_integrations`]);
    await db.transaction(trx => create.up(trx));
    await db.transaction(trx => create.up(trx));
    const distributed = await db.raw("SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'rmm_condition_states'::regclass");
    expect(distributed.rows).toHaveLength(1);
  }
  const tenants = [randomUUID(), randomUUID()];
  const integration = randomUUID();
  await db('rmm_integrations').insert(tenants.map(tenant => ({ tenant, integration_id: integration })));
  for (const tenant of tenants) {
    await db('rmm_condition_states').insert({
      tenant, integration_id: integration, scope_key: 'site', subject_key: 'device', condition_key: 'offline',
    });
    // More than one batch for each tenant; shared IDs and sub-millisecond
    // timestamps expose a cursor that loses tenant scope or timestamp precision.
    const rows = Array.from({ length: 505 }, (_, index) => ({
      tenant, integration_id: integration, scope_key: 'site', subject_key: 'device', condition_key: 'offline',
      transition_id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
      outage_id: randomUUID(), transition_kind: 'opened', external_alert_id: `alert-${index}`,
      event_payload: {}, created_at: `2026-11-01 00:00:00.${123456 + Math.floor(index / 2)}+00`,
    })).reverse();
    await db.batchInsert('rmm_condition_transitions', rows, 200);
  }

  await order.up(db);
  await ownership.up(db);
  for (const tenant of tenants) {
    const rows = await db('rmm_condition_transitions').where({ tenant }).orderBy('created_at').orderBy('transition_id');
    expect(rows.map(row => Number(row.condition_sequence))).toEqual(Array.from({ length: 505 }, (_, i) => i + 1));
    expect(Number((await db('rmm_condition_states').where({ tenant }).first()).transition_sequence)).toBe(505);
  }
  const snapshot = await db('rmm_condition_transitions').orderBy('tenant').orderBy('transition_id');
  // A live writer may have advanced the state beyond retained outbox history.
  await db('rmm_condition_states').where({ tenant: tenants[0] }).update({ transition_sequence: '9007199254741000' });
  await order.up(db);
  await ownership.up(db);
  expect(await db('rmm_condition_transitions').orderBy('tenant').orderBy('transition_id')).toEqual(snapshot);
  expect((await db('rmm_condition_states').where({ tenant: tenants[0] }).first()).transition_sequence).toBe('9007199254741000');

  const indexes = await db.raw(`SELECT c.relname, i.indisvalid FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ? AND c.relname IN ('idx_rmm_condition_transition_order', 'idx_rmm_condition_states_alert_owner')`, [schema]);
  expect(indexes.rows).toHaveLength(2);
  expect(indexes.rows.every((row: { indisvalid: boolean }) => row.indisvalid)).toBe(true);

  await ownership.down(db);
  await ownership.down(db);
  await ownership.up(db);
  expect(await db('rmm_condition_transitions').count('* AS count').first()).toEqual({ count: '1010' });
  await order.down(db);
  await order.down(db);
  await order.up(db);
  expect(Number((await db('rmm_condition_states').where({ tenant: tenants[0] }).first()).transition_sequence)).toBe(505);
  expect((await shadowIndexes()).rows).toEqual(beforeShadow.rows);

  // The deletion loop must explicitly clean both tables before the integration,
  // while preserving the other tenant's lifecycle rows.
  const lifecycleTables = ['rmm_condition_states', 'rmm_condition_transitions'];
  const deleted: Record<string, number> = {};
  for (const table of tenantDeletionOrder().filter(table => [...lifecycleTables, 'rmm_integrations'].includes(table))) {
    deleted[table] = await db(table).where({ tenant: tenants[0] }).delete();
  }
  expect(deleted.rmm_condition_states).toBe(1);
  expect(deleted.rmm_condition_transitions).toBe(505);
  expect(await db('rmm_condition_states').select('tenant')).toEqual([{ tenant: tenants[1] }]);
  expect(await db('rmm_condition_transitions').count('* AS count').first()).toEqual({ count: '505' });
}, 60_000);
