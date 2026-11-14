/**
 * T001/T002: the unifi_credentials migration backfills exactly one 'Default'
 * credential per existing UniFi integration (mode copied, local host id 'local'),
 * is idempotent, is a no-op with no UniFi integration, and never touches scope
 * keys or mappings. Runs in a throwaway database on the dev Postgres and is
 * skipped when that server is unreachable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261108120000_create_unifi_credentials_and_console_routes.cjs');

const connection = {
  host: process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT === '6432' ? 5432 : process.env.DB_PORT || 5432),
  user: process.env.DB_USER_ADMIN || 'postgres',
  password: process.env.DB_PASSWORD_ADMIN || process.env.DB_PASSWORD || '',
};
const scratchName = `unifi_creds_mig_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

let admin: Knex | undefined;
let db: Knex | undefined;
let reachable = false;

beforeAll(async () => {
  try {
    admin = knexFactory({ client: 'pg', connection: { ...connection, database: 'postgres' }, pool: { min: 0, max: 1 } });
    await admin.raw('select 1');
    await admin.raw(`CREATE DATABASE ${scratchName}`);
    db = knexFactory({ client: 'pg', connection: { ...connection, database: scratchName }, pool: { min: 0, max: 2 } });
    await db.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto').catch(() => undefined);
    await db.schema.createTable('rmm_integrations', (t) => {
      t.uuid('tenant').notNullable();
      t.uuid('integration_id').notNullable();
      t.text('provider').notNullable();
      t.jsonb('settings');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db!.fn.now());
      t.primary(['tenant', 'integration_id']);
    });
    await db.schema.createTable('rmm_organization_mappings', (t) => {
      t.uuid('tenant').notNullable();
      t.uuid('mapping_id').notNullable();
      t.uuid('integration_id').notNullable();
      t.text('external_organization_id').notNullable();
      t.primary(['tenant', 'mapping_id']);
    });
    reachable = true;
  } catch {
    reachable = false;
  }
}, 30000);

afterAll(async () => {
  await db?.destroy();
  if (admin && reachable) await admin.raw(`DROP DATABASE IF EXISTS ${scratchName}`).catch(() => undefined);
  await admin?.destroy();
});

describe('unifi credentials migration (needs Postgres)', () => {
  it('is safe with no UniFi integration', async (ctx) => {
    if (!reachable) return ctx.skip();
    const tenant = randomUUID();
    await db!('rmm_integrations').insert({ tenant, integration_id: randomUUID(), provider: 'ninjaone', settings: {} });
    await migration.up(db);
    expect((await db!('unifi_credentials').where({ tenant }).count('* as n'))[0].n).toBe('0');
  });

  it('backfills one Default credential per integration, in both modes, idempotently', async (ctx) => {
    if (!reachable) return ctx.skip();
    const tenant = randomUUID();
    const cloud = randomUUID();
    const local = randomUUID();
    await db!('rmm_integrations').insert([
      { tenant, integration_id: cloud, provider: 'unifi', settings: { connectionMode: 'site_manager' } },
      { tenant, integration_id: local, provider: 'unifi', settings: { connectionMode: 'local' } },
      { tenant, integration_id: randomUUID(), provider: 'ninjaone', settings: {} },
    ]);
    await db!('rmm_organization_mappings').insert([
      { tenant, mapping_id: randomUUID(), integration_id: cloud, external_organization_id: 'host-1:site-1' },
      { tenant, mapping_id: randomUUID(), integration_id: local, external_organization_id: 'local:site-9' },
    ]);
    const mappingsBefore = await db!('rmm_organization_mappings').where({ tenant }).orderBy('external_organization_id');

    await migration.up(db);
    await migration.up(db); // idempotent

    const rows = await db!('unifi_credentials').where({ tenant }).orderBy('mode');
    expect(rows).toHaveLength(2);
    const byIntegration = Object.fromEntries(rows.map((r: any) => [r.integration_id, r]));
    expect(byIntegration[cloud]).toMatchObject({ label: 'Default', mode: 'site_manager', local_host_id: null, status: 'active', adopts_legacy_secret: true });
    expect(byIntegration[local]).toMatchObject({ label: 'Default', mode: 'local', local_host_id: 'local', status: 'active', adopts_legacy_secret: true });

    // Scope keys and mappings are byte-identical; no routes are invented.
    expect(await db!('rmm_organization_mappings').where({ tenant }).orderBy('external_organization_id')).toEqual(mappingsBefore);
    expect((await db!('unifi_console_routes').where({ tenant }).count('* as n'))[0].n).toBe('0');
  });
});
